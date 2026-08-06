/**
 * Catalog ↔ coverage-table consistency, plus the pure statistics behind it.
 *
 * No GPU here on purpose: this is the fast guard that fires the moment someone
 * adds a Generator without re-running the sweep. The GPU counterpart
 * (`gl/coverage.gpu.test.ts`) checks that the recorded numbers still match what
 * the shaders actually draw.
 */
import { describe, expect, it } from 'vitest';
import {
  COVERAGE_DECIMALS,
  COVERAGE_SOLID_ALPHA,
  distributionOf,
  mean,
  missingCoverageIds,
  percentile,
  roundCoverage,
  staleCoverageIds,
} from './coverage';
import { GENERATOR_COVERAGE } from './coverage.generated';
import { derivePatch } from './derive';
import { inlineCatalog } from './generators';
import {
  allCoverageIds,
  COVERAGE_BASE_SOURCE,
  coverageContext,
  COVERAGE_PARAM_SETS,
  COVERAGE_TIMES,
  coverageSeed,
  pickCoverageParameter,
  renderCoverageModule,
  sampledCoverageIds,
} from './gl/coverageMeasure';

const REGENERATE = 'Run `pnpm measure:coverage` to regenerate src/synth/coverage.generated.ts.';

describe('synth coverage table ↔ catalog', () => {
  const catalogIds = inlineCatalog.all().map((g) => g.def.id);

  it('has a measurement for every generator in the catalog', () => {
    const missing = missingCoverageIds(GENERATOR_COVERAGE, catalogIds);
    expect(
      missing,
      missing.length === 0
        ? ''
        : `${missing.length} generator(s) have no measured coverage: ${missing.join(', ')}. ` +
            REGENERATE,
    ).toEqual([]);
  });

  it('has no entries for generators the catalog no longer has', () => {
    const stale = staleCoverageIds(GENERATOR_COVERAGE, catalogIds);
    expect(
      stale,
      stale.length === 0
        ? ''
        : `${stale.length} coverage entr(ies) are not in the catalog: ${stale.join(', ')}. ` +
            REGENERATE,
    ).toEqual([]);
  });

  it('measures exactly the catalog, no more and no less', () => {
    expect(Object.keys(GENERATOR_COVERAGE).length, REGENERATE).toBe(catalogIds.length);
    expect(allCoverageIds()).toEqual([...catalogIds].sort());
  });

  it('records the base source, so non-source coverage can be read as a delta', () => {
    expect(GENERATOR_COVERAGE[COVERAGE_BASE_SOURCE], REGENERATE).toBeDefined();
  });

  it('stores plausible, ordered, rounded values', () => {
    const metrics = ['meanAlpha', 'solidFraction'] as const;
    const quantiles = ['p10', 'p50', 'p90'] as const;
    for (const [id, cov] of Object.entries(GENERATOR_COVERAGE)) {
      for (const metric of metrics) {
        const d = cov[metric];
        const where = `${id}.${metric}`;
        for (const q of quantiles) {
          const v = d[q];
          expect(v, `${where}.${q} out of range`).toBeGreaterThanOrEqual(0);
          expect(v, `${where}.${q} out of range`).toBeLessThanOrEqual(1);
          expect(roundCoverage(v), `${where}.${q} is not rounded`).toBe(v);
        }
        expect(d.p10, `${where}: p10 > p50`).toBeLessThanOrEqual(d.p50);
        expect(d.p50, `${where}: p50 > p90`).toBeLessThanOrEqual(d.p90);
      }
    }
  });
});

describe('synth coverage statistics', () => {
  it('percentile interpolates linearly between order statistics', () => {
    const values = [0, 1, 2, 3, 4];
    expect(percentile(values, 0)).toBe(0);
    expect(percentile(values, 1)).toBe(4);
    expect(percentile(values, 0.5)).toBe(2);
    // (n-1)*0.1 = 0.4 → 0 + (1-0)*0.4
    expect(percentile(values, 0.1)).toBeCloseTo(0.4, 12);
  });

  it('percentile does not depend on input order', () => {
    const a = [0.9, 0.1, 0.5, 0.3];
    const b = [0.1, 0.3, 0.5, 0.9];
    expect(percentile(a, 0.5)).toBe(percentile(b, 0.5));
  });

  it('percentile leaves its input untouched', () => {
    const values = [3, 1, 2];
    percentile(values, 0.5);
    expect(values).toEqual([3, 1, 2]);
  });

  it('distributionOf rounds to the stored precision', () => {
    const d = distributionOf([0.123456, 0.223456, 0.323456]);
    expect(d.p50).toBe(0.2235);
    expect(String(d.p50).split('.')[1]!.length).toBeLessThanOrEqual(COVERAGE_DECIMALS);
  });

  it('mean and percentile reject an empty sample instead of returning NaN', () => {
    expect(() => mean([])).toThrow();
    expect(() => percentile([], 0.5)).toThrow();
  });

  it('exposes the solid-alpha threshold the measurement uses', () => {
    expect(COVERAGE_SOLID_ALPHA).toBe(0.5);
  });
});

describe('synth coverage measurement plan', () => {
  it('samples several times so a blinking generator cannot fake an empty frame', () => {
    expect(COVERAGE_TIMES.length).toBeGreaterThanOrEqual(3);
    expect(new Set(COVERAGE_TIMES).size).toBe(COVERAGE_TIMES.length);
  });

  it('draws several parameter sets so the result is a distribution', () => {
    expect(COVERAGE_PARAM_SETS).toBeGreaterThanOrEqual(8);
  });

  it('measures sources alone, with no material to colour the alpha', () => {
    const ctx = coverageContext('grid', 0);
    expect(ctx.role).toBe('source');
    expect(ctx.patch.operators).toHaveLength(1);
    expect(ctx.patch.operators[0]!.generatorId).toBe('grid');
  });

  it('measures every other category on the shared base source', () => {
    for (const id of ['neon', 'noise', 'threshold', 'mirror']) {
      const ctx = coverageContext(id, 0);
      expect(ctx.role, id).not.toBe('source');
      const ids = ctx.patch.operators.map((o) => o.generatorId);
      expect(ids, id).toContain(COVERAGE_BASE_SOURCE);
      expect(ids, id).toContain(id);
      expect(ctx.patch.operators, id).toHaveLength(2);
    }
  });

  it('gives the base source identical parameters in every context', () => {
    const base = coverageContext(COVERAGE_BASE_SOURCE, 3).patch.operators[0]!;
    for (const id of ['neon', 'noise', 'threshold', 'mirror']) {
      const op = coverageContext(id, 3).patch.operators.find(
        (o) => o.generatorId === COVERAGE_BASE_SOURCE,
      );
      expect(op, id).toBeDefined();
      expect(op!.id, id).toBe(base.id);
      expect(op!.parameters, id).toEqual(base.parameters);
    }
  });

  it('is deterministic: the same parameter set builds the same patch', () => {
    expect(coverageContext('stripes', 5).patch).toEqual(coverageContext('stripes', 5).patch);
  });

  it('actually varies the measured generator across parameter sets', () => {
    const seen = new Set<string>();
    for (let k = 0; k < COVERAGE_PARAM_SETS; k++) {
      seen.add(JSON.stringify(coverageContext('stripes', k).patch.operators[0]!.parameters));
    }
    expect(seen.size).toBe(COVERAGE_PARAM_SETS);
  });

  it('keeps the drift sample deterministic, sorted and inside the catalog', () => {
    const ids = allCoverageIds();
    const a = sampledCoverageIds(ids, 12);
    const b = sampledCoverageIds(ids, 12);
    expect(a).toEqual(b);
    expect(a).toHaveLength(12);
    expect([...a].sort()).toEqual(a);
    for (const id of a) expect(ids).toContain(id);
  });

  it('keeps most of the drift sample when the catalog grows', () => {
    const ids = allCoverageIds();
    const before = sampledCoverageIds(ids, 12);
    const after = sampledCoverageIds([...ids, 'brandNewGenerator'], 12);
    const kept = after.filter((id) => before.includes(id));
    expect(kept.length).toBeGreaterThanOrEqual(11);
  });
});

describe('synth coverage parameter draw', () => {
  /**
   * pickCoverageParameter is a copy of derive.ts's private `pickParameter`
   * (this PR must not touch derive.ts). Re-derive real patches and compare
   * every parameter so the copy cannot silently drift.
   */
  it('matches derive.ts pickParameter for every operator of a derived patch', () => {
    for (const seed of ['coverage-parity-a', 'coverage-parity-b', 'coverage-parity-c']) {
      const patch = derivePatch(seed, { catalog: inlineCatalog });
      expect(patch.operators.length).toBeGreaterThan(0);
      for (const op of patch.operators) {
        const gen = inlineCatalog.get(op.generatorId)!;
        for (const param of gen.def.parameters) {
          expect(
            pickCoverageParameter(seed, op.id, param),
            `${seed} / ${op.id}.${param.id}`,
          ).toEqual(op.parameters[param.id]);
        }
      }
    }
  });

  it('keeps drawn values inside the declared parameter range', () => {
    for (const gen of inlineCatalog.all()) {
      for (const param of gen.def.parameters) {
        for (let k = 0; k < COVERAGE_PARAM_SETS; k++) {
          const v = pickCoverageParameter(coverageSeed(k), 'src0', param);
          switch (param.kind) {
            case 'number':
            case 'int': {
              const min = param.min ?? 0;
              const max = param.max ?? (param.kind === 'int' ? min : 1);
              expect(typeof v, `${gen.def.id}.${param.id}`).toBe('number');
              expect(v as number).toBeGreaterThanOrEqual(min);
              expect(v as number).toBeLessThanOrEqual(max);
              if (param.kind === 'int') expect(Number.isInteger(v)).toBe(true);
              break;
            }
            case 'bool':
              expect(typeof v, `${gen.def.id}.${param.id}`).toBe('boolean');
              break;
            case 'enum':
              expect(param.options ?? [], `${gen.def.id}.${param.id}`).toContain(v);
              break;
          }
        }
      }
    }
  });
});

describe('synth coverage generated module', () => {
  const sample = [
    {
      id: 'zzz',
      role: 'source' as const,
      coverage: {
        meanAlpha: { p10: 0, p50: 0.5, p90: 1 },
        solidFraction: { p10: 0.1234, p50: 0.5, p90: 1 },
      },
      meanAlphaSamples: [],
      solidFractionSamples: [],
    },
    {
      id: 'aaa',
      role: 'material' as const,
      coverage: {
        meanAlpha: { p10: 0, p50: 0.25, p90: 0.5 },
        solidFraction: { p10: 0, p50: 0.25, p90: 0.5 },
      },
      meanAlphaSamples: [],
      solidFractionSamples: [],
    },
  ];

  it('shouts that it is generated and how to regenerate it', () => {
    const src = renderCoverageModule(sample);
    expect(src).toContain('GENERATED FILE');
    expect(src).toContain('pnpm measure:coverage');
  });

  it('sorts entries by id so a re-run produces a readable diff', () => {
    const src = renderCoverageModule(sample);
    expect(src.indexOf('  aaa:')).toBeGreaterThan(-1);
    expect(src.indexOf('  aaa:')).toBeLessThan(src.indexOf('  zzz:'));
  });

  /**
   * Numbers are emitted exactly as oxfmt would write them (trailing zeros
   * dropped, one digit kept after the point). Otherwise every sweep would leave
   * the tree failing `pnpm format:check`.
   */
  it('writes numeric literals the way the formatter would', () => {
    const src = renderCoverageModule(sample);
    expect(src).toContain('meanAlpha: { p10: 0.0, p50: 0.5, p90: 1.0 },');
    expect(src).toContain('solidFraction: { p10: 0.1234, p50: 0.5, p90: 1.0 },');
  });

  it('re-emits the recorded table with the same shape as the committed file', () => {
    const rebuilt = renderCoverageModule(
      Object.entries(GENERATOR_COVERAGE).map(([id, coverage]) => ({
        id,
        role: 'source' as const,
        coverage,
        meanAlphaSamples: [],
        solidFractionSamples: [],
      })),
    );
    for (const id of Object.keys(GENERATOR_COVERAGE)) {
      expect(rebuilt, `${id} missing from the re-emitted module. ${REGENERATE}`).toContain(
        `  ${id}: {`,
      );
    }
    expect(rebuilt.split('\n').filter((l) => l.startsWith('    meanAlpha:'))).toHaveLength(
      Object.keys(GENERATOR_COVERAGE).length,
    );
  });
});
