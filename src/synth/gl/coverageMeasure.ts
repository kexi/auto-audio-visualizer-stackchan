/**
 * Measure how much of the frame each Generator fills, on a real GPU.
 *
 * Driven by `pnpm measure:coverage` (scripts/measure-coverage.mjs) and reused
 * by the drift-detection GPU test. Read `../coverage.ts` first for what the two
 * metrics mean and why both are needed.
 *
 * Measurement rules — breaking any of these makes the numbers lie:
 *
 * 1. A source is measured ALONE, with no material. `assemblePatch` falls back
 *    to `vec4(v, v, v, v)` when a patch has no material, so alpha *is* the
 *    source's density. Stacking `neon` (or any material) on top would mix that
 *    material's own habits into the number.
 * 2. Several fixed times, integrated. Measuring only `uTime = 0` would brand a
 *    Generator "empty" because its animation happened to be at a blank phase.
 *    The sample times are mutually incommensurable-ish so they cannot all land
 *    on the same phase of a common period.
 * 3. Several parameter sets. Coverage swings wildly with parameters
 *    (`stripes` at thickness 0.1 vs 0.9 are different Generators, visually), so
 *    the result is a distribution (p10/p50/p90) over deterministically drawn
 *    parameter sets, not a single point.
 * 4. One shared solo context per category. Everything that is not a source is
 *    measured on top of the same base source (`grid`), so the numbers are
 *    comparable across generators. The base source uses the same opId + seed in
 *    every context, so its parameters are identical everywhere: the `grid`
 *    entry itself is the baseline, and `material` (or field/modifier) coverage
 *    minus the `grid` entry is exactly what that operator did to the base.
 * 5. Fully deterministic: fixed seeds, fixed times, fixed resolution. 256px,
 *    not 64px — at 64 the pixel centers miss thin strokes and a lattice reads
 *    as an empty frame (the lesson `render.gpu.test.ts` already learned).
 */
import type { Page } from 'playwright';
import {
  distributionOf,
  mean,
  roundCoverage,
  type GeneratorCoverage,
  COVERAGE_SOLID_ALPHA,
} from '../coverage';
import { inlineCatalog } from '../generators';
import type { InlineGenerator } from '../generators/types';
import { namespaceToU32, rand } from '../rng';
import type { ParameterDefinition, VisualOperator, VisualPatch } from '../types';
import {
  basePatch,
  closeGpu,
  launchGpu,
  measurePatchFrames,
  requireGen,
  roleOf,
  type PatchRole,
} from './gpuHarness';

/** Render size. Below ~256 thin strokes fall between pixel centers and vanish. */
export const COVERAGE_SIZE = 256;

/**
 * Time samples, in seconds. Chosen so no single period lines all four up on the
 * same phase; a Generator that blinks cannot fake "always empty" or "always full".
 */
export const COVERAGE_TIMES: readonly number[] = [0.0, 1.7, 4.3, 9.1];

/** Parameter sets drawn per generator — the sample the distribution is built from. */
export const COVERAGE_PARAM_SETS = 8;

/** Base source every non-source generator is measured on top of. */
export const COVERAGE_BASE_SOURCE = 'grid';

/** Seed prefix for the parameter draw. Changing it invalidates the whole table. */
export const COVERAGE_SEED = 'coverage-v1';

/**
 * How far a re-measurement may drift from the recorded value before the GPU
 * test fails. Same machine reproduces bit-for-bit; the slack is for a different
 * GPU / ANGLE backend, not for "the shader changed".
 */
export const COVERAGE_DRIFT_TOLERANCE = 0.02;

/** Generators re-measured by the drift test when not running the full sweep. */
export const COVERAGE_DRIFT_SAMPLE_SIZE = 12;

const COVERAGE_SAMPLE_SEED = 'coverage-drift-sample';
const COVERAGE_SAMPLE_NS = 'test:coverage:sample';

/** Path (from the repo root) the generated table is written to. */
export const COVERAGE_OUTPUT_PATH = 'src/synth/coverage.generated.ts';

/** Seed for parameter set `k`. */
export function coverageSeed(setIndex: number): string {
  return `${COVERAGE_SEED}:set:${setIndex}`;
}

// ---------------------------------------------------------------------------
// deterministic parameter draw
// ---------------------------------------------------------------------------

/**
 * Inclusive integer in [min, max] — mirrors derive.ts's private `randInt`.
 */
function randInt(seed: string, ns: string, index: number, min: number, max: number): number {
  if (max <= min) return min;
  const r = rand(seed, ns, index);
  return Math.min(max, min + Math.floor(r * (max - min + 1)));
}

/**
 * Mirror of `pickParameter` in derive.ts.
 *
 * Deliberately a copy: this PR measures, it does not touch the runtime, and
 * derive.ts keeps its function private. `coverage.test.ts` asserts the two stay
 * in lockstep by re-deriving real patches and comparing every parameter, so a
 * change to derive.ts that is not mirrored here fails loudly.
 */
export function pickCoverageParameter(
  seed: string,
  opId: string,
  param: ParameterDefinition,
): number | string | boolean {
  const ns = `patch:param:${opId}:${param.id}`;
  switch (param.kind) {
    case 'number': {
      const min = param.min ?? 0;
      const max = param.max ?? 1;
      return min + rand(seed, ns, 0) * (max - min);
    }
    case 'int': {
      const min = param.min ?? 0;
      const max = param.max ?? min;
      return randInt(seed, ns, 0, min, max);
    }
    case 'bool':
      return rand(seed, ns, 0) < 0.5;
    case 'enum': {
      const options = param.options ?? [];
      if (options.length === 0) {
        if (typeof param.default === 'string') return param.default;
        throw new Error(`pickCoverageParameter: enum "${param.id}" has no options`);
      }
      const idx = randInt(seed, ns, 0, 0, options.length - 1);
      return options[idx]!;
    }
    default: {
      const _exhaustive: never = param.kind;
      return _exhaustive;
    }
  }
}

function coverageOperator(seed: string, opId: string, gen: InlineGenerator): VisualOperator {
  const parameters: Record<string, number | string | boolean> = {};
  for (const param of gen.def.parameters) {
    parameters[param.id] = pickCoverageParameter(seed, opId, param);
  }
  return {
    id: opId,
    generatorId: gen.def.id,
    generatorVersion: gen.def.version,
    parameters,
  };
}

// ---------------------------------------------------------------------------
// solo contexts
// ---------------------------------------------------------------------------

/** opId a generator gets in its solo context. The base source always takes `src0`. */
function opIdForRole(role: PatchRole): string {
  switch (role) {
    case 'source':
      return 'src0';
    case 'field':
      return 'fld0';
    case 'mod_coord':
    case 'mod_value':
      return 'mod0';
    case 'material':
      return 'mat0';
  }
}

export interface CoverageContext {
  label: string;
  role: PatchRole;
  patch: VisualPatch;
}

/**
 * The patch a generator is measured in, for parameter set `setIndex`.
 *
 * Sources render alone (no material — see rule 1). Everything else sits on the
 * shared base source, which is built from the same seed and opId in every
 * context so it contributes identically each time.
 */
export function coverageContext(genId: string, setIndex: number): CoverageContext {
  const gen = requireGen(genId);
  const role = roleOf(gen.def);
  const seed = coverageSeed(setIndex);
  const self = coverageOperator(seed, opIdForRole(role), gen);

  if (role === 'source') {
    return { label: `source:${genId}`, role, patch: basePatch([self], seed) };
  }

  const base = coverageOperator(seed, 'src0', requireGen(COVERAGE_BASE_SOURCE));
  const operators =
    // coord modifiers bend `p` before any source reads it
    role === 'mod_coord' ? [self, base] : [base, self];
  return {
    label: `${role}:${genId}+source:${COVERAGE_BASE_SOURCE}`,
    role,
    patch: basePatch(operators, seed),
  };
}

// ---------------------------------------------------------------------------
// measurement
// ---------------------------------------------------------------------------

/** One generator's measurement, plus the raw per-parameter-set samples. */
export interface CoverageMeasurement {
  id: string;
  role: PatchRole;
  coverage: GeneratorCoverage;
  /** Per parameter set, already integrated over COVERAGE_TIMES. */
  meanAlphaSamples: number[];
  solidFractionSamples: number[];
}

/**
 * Measure one generator: COVERAGE_PARAM_SETS parameter sets × COVERAGE_TIMES
 * time samples. Times are integrated (mean) into one value per parameter set,
 * then the parameter sets become the p10/p50/p90 distribution.
 */
export async function measureGeneratorCoverage(
  page: Page,
  genId: string,
): Promise<CoverageMeasurement> {
  const meanAlphaSamples: number[] = [];
  const solidFractionSamples: number[] = [];
  let role: PatchRole = 'source';

  for (let k = 0; k < COVERAGE_PARAM_SETS; k++) {
    const ctx = coverageContext(genId, k);
    role = ctx.role;
    // One evaluate call per parameter set: the program is compiled once and
    // re-drawn at each time sample, and only the per-frame scalars come back.
    const res = await measurePatchFrames(page, ctx.patch, COVERAGE_SIZE, [...COVERAGE_TIMES]);
    if (!res.ok) {
      throw new Error(`coverage: ${ctx.label} (set ${k}) failed to render: ${res.log}`);
    }
    meanAlphaSamples.push(mean(res.frames.map((f) => f.meanAlpha)));
    solidFractionSamples.push(mean(res.frames.map((f) => f.solidFraction)));
  }

  return {
    id: genId,
    role,
    coverage: {
      meanAlpha: distributionOf(meanAlphaSamples),
      solidFraction: distributionOf(solidFractionSamples),
    },
    meanAlphaSamples,
    solidFractionSamples,
  };
}

/** Catalog ids, sorted, so the sweep order and the generated file are stable. */
export function allCoverageIds(): string[] {
  return inlineCatalog
    .all()
    .map((g) => g.def.id)
    .sort();
}

/**
 * A deterministic subset for the drift test.
 *
 * Rendezvous-style: every id gets an independent weight and the top `count`
 * win, so adding a generator reshuffles the sample only when the newcomer
 * outranks the current cut-off (rather than shifting every pick).
 */
export function sampledCoverageIds(ids: readonly string[], count: number): string[] {
  const weight = (id: string) => rand(COVERAGE_SAMPLE_SEED, COVERAGE_SAMPLE_NS, namespaceToU32(id));
  return [...ids]
    .sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1))
    .slice(0, count)
    .sort();
}

// ---------------------------------------------------------------------------
// generated file
// ---------------------------------------------------------------------------

/**
 * A measurement as a numeric literal, written the way oxfmt would write it.
 *
 * The value is rounded to COVERAGE_DECIMALS so diffs stay readable; the literal
 * drops redundant trailing zeros (but keeps one digit after the point) because
 * that is exactly what `pnpm format` would rewrite it to. Emitting the padded
 * form instead would make every sweep fight the formatter.
 */
function num(value: number): string {
  const s = String(roundCoverage(value));
  return s.includes('.') ? s : `${s}.0`;
}

/** Object key, quoted only when it is not a plain identifier (matches oxfmt). */
function key(id: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(id) ? id : `'${id.replace(/'/g, "\\'")}'`;
}

function dist(label: string, d: { p10: number; p50: number; p90: number }): string {
  return `    ${label}: { p10: ${num(d.p10)}, p50: ${num(d.p50)}, p90: ${num(d.p90)} },`;
}

/** Render the whole `coverage.generated.ts` module source. */
export function renderCoverageModule(measurements: readonly CoverageMeasurement[]): string {
  const sorted = [...measurements].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lines: string[] = [];

  lines.push('/**');
  lines.push(' * GENERATED FILE — 手で編集しないこと。');
  lines.push(' * `pnpm measure:coverage` で再生成する。');
  lines.push(' *');
  lines.push(' * Generator ごとの画面占有度の実測値。意味と測り方は ./coverage.ts と');
  lines.push(' * ./gl/coverageMeasure.ts を参照。要点だけ:');
  lines.push(' *');
  lines.push(` * - ${COVERAGE_SIZE}x${COVERAGE_SIZE} の WebGL2 オフスクリーンで実測`);
  lines.push(
    ` * - 時刻 ${COVERAGE_TIMES.join(' / ')} 秒の ${COVERAGE_TIMES.length} サンプルを平均`,
  );
  lines.push(` * - パラメータは seed "${COVERAGE_SEED}" から決定的に引いた`);
  lines.push(` *   ${COVERAGE_PARAM_SETS} セット。その分布が p10 / p50 / p90`);
  lines.push(' * - source は material 無しの単体（fragColor = vec4(v,v,v,v)）で測る');
  lines.push(` * - source 以外は基準 source "${COVERAGE_BASE_SOURCE}" の上で測る。基準は`);
  lines.push(` *   全コンテキストで同一パラメータなので、"${COVERAGE_BASE_SOURCE}" のエントリとの`);
  lines.push(' *   差がその operator の寄与になる');
  lines.push(` * - solidFraction はアルファ > ${COVERAGE_SOLID_ALPHA} のピクセル比率`);
  lines.push(' */');
  lines.push("import type { CoverageTable } from './coverage';");
  lines.push('');
  lines.push('export const GENERATOR_COVERAGE: CoverageTable = {');
  for (const m of sorted) {
    lines.push(`  ${key(m.id)}: {`);
    lines.push(dist('meanAlpha', m.coverage.meanAlpha));
    lines.push(dist('solidFraction', m.coverage.solidFraction));
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

function rankTable(
  title: string,
  rows: readonly CoverageMeasurement[],
  value: (m: CoverageMeasurement) => number,
): string {
  const lines = [title];
  rows.forEach((m, i) => {
    const rank = String(i + 1).padStart(2, ' ');
    lines.push(`${rank}. ${m.id.padEnd(24, ' ')} ${value(m).toFixed(4)}  (${m.role})`);
  });
  return lines.join('\n');
}

/** Human-readable ranking printed after a sweep. */
export function formatCoverageSummary(measurements: readonly CoverageMeasurement[]): string {
  const byMean = [...measurements].sort(
    (a, b) => b.coverage.meanAlpha.p50 - a.coverage.meanAlpha.p50,
  );
  const bySolid = [...measurements].sort(
    (a, b) => b.coverage.solidFraction.p50 - a.coverage.solidFraction.p50,
  );
  return [
    rankTable(
      '# meanAlpha.p50 — top 15 (最も描いている)',
      byMean.slice(0, 15),
      (m) => m.coverage.meanAlpha.p50,
    ),
    '',
    rankTable(
      '# meanAlpha.p50 — bottom 15 (最も余白を残す)',
      byMean.slice(-15).reverse(),
      (m) => m.coverage.meanAlpha.p50,
    ),
    '',
    rankTable(
      '# solidFraction.p50 — top 10 (下の映像を最も塞ぐ)',
      bySolid.slice(0, 10),
      (m) => m.coverage.solidFraction.p50,
    ),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// sweep entry point
// ---------------------------------------------------------------------------

export interface SweepProgress {
  index: number;
  total: number;
  id: string;
  coverage: GeneratorCoverage;
}

export interface SweepResult {
  measurements: CoverageMeasurement[];
  /** Full source text of `coverage.generated.ts`. */
  source: string;
  summary: string;
}

/**
 * Measure every generator and produce the generated module source.
 *
 * Launches (and always closes) its own Chromium. Fails loudly when no browser
 * is available — a measurement run that silently produces nothing would be far
 * worse than a red script.
 */
export async function runCoverageSweep(
  onProgress?: (p: SweepProgress) => void,
): Promise<SweepResult> {
  const session = await launchGpu('[measure:coverage] browser launch failed:');
  const page = session.page;
  if (!page) {
    await closeGpu(session);
    throw new Error(
      'measure:coverage needs a headless Chromium. Enter `nix develop` so CHROMIUM_BIN is set ' +
        `(launch error: ${
          session.error instanceof Error ? session.error.message : String(session.error)
        })`,
    );
  }

  try {
    const ids = allCoverageIds();
    const measurements: CoverageMeasurement[] = [];
    for (const [index, id] of ids.entries()) {
      const m = await measureGeneratorCoverage(page, id);
      measurements.push(m);
      onProgress?.({ index, total: ids.length, id, coverage: m.coverage });
    }
    return {
      measurements,
      source: renderCoverageModule(measurements),
      summary: formatCoverageSummary(measurements),
    };
  } finally {
    await closeGpu(session);
  }
}
