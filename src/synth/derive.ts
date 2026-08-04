/**
 * seed → VisualPatch の決定的導出。
 *
 * 描画は行わない。カタログから Generator を選び、パラメータ・palette・composition を
 * 名前付き RNG で埋め、validate / budget を満たすパッチを返す。
 */
import { createCatalog } from './catalog';
import { DEFAULT_BUDGETS, estimateCost, fitsBudget } from './cost';
import type { InlineGenerator, InlineGeneratorCatalog } from './generators/types';
import { DEFAULT_SMOOTHING } from './modulation';
import { namespaceToU32, rand } from './rng';
import { CURRENT_SCHEMA_VERSION } from './schema';
import type {
  GeneratorCategory,
  ModulationRoute,
  ParameterDefinition,
  PaletteMode,
  QualityTier,
  VisualOperator,
  VisualPatch,
} from './types';
import { validatePatch } from './validate';

export interface DeriveOptions {
  /** 使う Generator カタログ。 */
  catalog: InlineGeneratorCatalog;
  /** 品質ティア（既定 'medium'）。 */
  qualityTier?: QualityTier;
}

const PALETTE_MODES: readonly PaletteMode[] = [
  'mono',
  'analogous',
  'complementary',
  'triadic',
  'rainbow',
];

/**
 * Audio→param route sources for derived patches.
 *
 * Design intent prefers beatIntensity/gridPulse (see modulation engine), but
 * validate.ts currently allows bass/mid/treble/level/beat/barPhase/beatPhase
 * and rejects beatIntensity/gridPulse. Use the intersection of validate-accepted
 * sources and modulation-resolved sources so routes always pass validatePatch.
 */
const ROUTE_SOURCES = [
  'audio:bass',
  'audio:mid',
  'audio:treble',
  'audio:level',
  'audio:beatPhase',
  'audio:barPhase',
] as const;

const MAX_STRIP_ATTEMPTS = 32;

/** Inclusive integer in [min, max]. Avoids off-by-one when rand is in [0, 1). */
function randInt(seed: string, ns: string, index: number, min: number, max: number): number {
  if (max <= min) return min;
  const r = rand(seed, ns, index);
  return Math.min(max, min + Math.floor(r * (max - min + 1)));
}

function pickParameter(
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
        throw new Error(`pickParameter: enum "${param.id}" has no options`);
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

/**
 * Highest-random-weight (rendezvous) selection for a slot.
 *
 * WHY rendezvous hashing (not array-index / `floor(rand * n)`):
 * When a new generator is added to the catalog, index-based picks reshuffle almost all
 * existing seed→generator mappings (every seed whose residual lands past the insert point).
 * Rendezvous assigns each candidate an independent weight `rand(seed, slot, hash(id))` and
 * takes the max. Adding or removing one generator only changes the winner when the newcomer
 * beats the previous max (probability ~1/(n+1)), so most seeds keep a stable mapping.
 * カタログに Generator を追加しても、既存 seed の選択が全面シャッフルされないことが重要。
 */
function pickByRendezvous(
  seed: string,
  slot: string,
  candidates: InlineGenerator[],
): InlineGenerator {
  if (candidates.length === 0) {
    throw new Error(`pickByRendezvous: no candidates for slot "${slot}"`);
  }
  const weight = (genId: string) => rand(seed, `patch:pick:${slot}`, namespaceToU32(genId));
  return candidates.reduce((best, c) => (weight(c.def.id) > weight(best.def.id) ? c : best));
}

function operatorsByCategory(
  operators: VisualOperator[],
  defCatalog: ReturnType<typeof createCatalog>,
): Record<GeneratorCategory, number[]> {
  const result: Record<GeneratorCategory, number[]> = {
    source: [],
    field: [],
    modifier: [],
    material: [],
  };
  for (let i = 0; i < operators.length; i++) {
    const op = operators[i]!;
    const def = defCatalog.get(op.generatorId);
    if (!def) continue;
    result[def.category].push(i);
  }
  return result;
}

/**
 * Drop one operator to reduce cost while respecting min counts.
 * Prefer fields → extra modifiers (down to 1) → extra sources (down to 1). Keep material.
 */
function stripOneOperator(
  operators: VisualOperator[],
  defCatalog: ReturnType<typeof createCatalog>,
): VisualOperator[] | null {
  const byCat = operatorsByCategory(operators, defCatalog);
  let dropIndex: number | undefined;

  if (byCat.field.length > 0) {
    dropIndex = byCat.field[byCat.field.length - 1];
  } else if (byCat.modifier.length > 1) {
    dropIndex = byCat.modifier[byCat.modifier.length - 1];
  } else if (byCat.source.length > 1) {
    dropIndex = byCat.source[byCat.source.length - 1];
  } else {
    return null;
  }

  return operators.filter((_, i) => i !== dropIndex);
}

function buildOperator(seed: string, opId: string, gen: InlineGenerator): VisualOperator {
  const parameters: Record<string, number | string | boolean> = {};
  for (const param of gen.def.parameters) {
    parameters[param.id] = pickParameter(seed, opId, param);
  }
  return {
    id: opId,
    generatorId: gen.def.id,
    generatorVersion: gen.def.version,
    parameters,
  };
}

function pickOperatorsForCategory(
  seed: string,
  category: GeneratorCategory,
  count: number,
  pool: InlineGenerator[],
  chosenIds: Set<string>,
  idPrefix: string,
  slotPrefix: string,
): VisualOperator[] {
  const ops: VisualOperator[] = [];
  for (let i = 0; i < count; i++) {
    const candidates = pool.filter((g) => !chosenIds.has(g.def.id));
    if (candidates.length === 0) break;
    const gen = pickByRendezvous(seed, `${slotPrefix}${i}`, candidates);
    chosenIds.add(gen.def.id);
    ops.push(buildOperator(seed, `${idPrefix}${i}`, gen));
  }
  if (ops.length === 0 && category !== 'field') {
    // source / modifier / material require at least one when pool is non-empty; empty pool is fatal.
    if (pool.length === 0) {
      throw new Error(`derivePatch: catalog has no "${category}" generators`);
    }
  }
  return ops;
}

function buildPalette(seed: string): VisualPatch['palette'] {
  const modeIdx = randInt(seed, 'patch:palette:mode', 0, 0, PALETTE_MODES.length - 1);
  return {
    mode: PALETTE_MODES[modeIdx]!,
    hueOffset: rand(seed, 'patch:palette:hue', 0) * 360,
    saturation: rand(seed, 'patch:palette:sat', 0) * 100,
    lightness: rand(seed, 'patch:palette:lit', 0) * 100,
  };
}

function buildComposition(seed: string): VisualPatch['composition'] {
  return {
    symmetry: randInt(seed, 'patch:comp:symmetry', 0, 1, 8),
    scale: 0.5 + rand(seed, 'patch:comp:scale', 0) * 1.5,
    speed: 0.25 + rand(seed, 'patch:comp:speed', 0) * 1.75,
  };
}

function isValidInBudget(
  patch: VisualPatch,
  defCatalog: ReturnType<typeof createCatalog>,
): boolean {
  if (validatePatch(patch, defCatalog).length > 0) return false;
  const budget = DEFAULT_BUDGETS[patch.qualityTier];
  return fitsBudget(estimateCost(patch, defCatalog), budget).length === 0;
}

interface RouteTargetCandidate {
  key: string;
  min: number;
  max: number;
}

function collectRouteTargets(
  operators: VisualOperator[],
  defCatalog: ReturnType<typeof createCatalog>,
): RouteTargetCandidate[] {
  const out: RouteTargetCandidate[] = [];
  for (const op of operators) {
    const def = defCatalog.get(op.generatorId);
    if (!def) continue;
    for (const param of def.parameters) {
      if (!param.modulatable) continue;
      if (param.kind !== 'number' && param.kind !== 'int') continue;
      if (typeof param.min !== 'number' || typeof param.max !== 'number') continue;
      if (!(param.max > param.min)) continue;
      out.push({
        key: `${op.id}.${param.id}`,
        min: param.min,
        max: param.max,
      });
    }
  }
  return out;
}

function pickStringByRendezvous(seed: string, ns: string, candidates: readonly string[]): string {
  if (candidates.length === 0) {
    throw new Error(`pickStringByRendezvous: no candidates for "${ns}"`);
  }
  const weight = (key: string) => rand(seed, ns, namespaceToU32(key));
  return candidates.reduce((best, c) => (weight(c) > weight(best) ? c : best));
}

/** Build 1–3 audio→param routes against final operators. No duplicate targets. */
function buildRoutes(
  seed: string,
  operators: VisualOperator[],
  defCatalog: ReturnType<typeof createCatalog>,
): ModulationRoute[] {
  const targets = collectRouteTargets(operators, defCatalog);
  if (targets.length === 0) return [];

  const count = Math.min(randInt(seed, 'patch:route:count', 0, 1, 3), targets.length);
  if (count <= 0) return [];

  const remaining = [...targets];
  const routes: ModulationRoute[] = [];

  for (let i = 0; i < count; i++) {
    const source = pickStringByRendezvous(seed, `patch:route:${i}:source`, ROUTE_SOURCES);
    const targetKeys = remaining.map((t) => t.key);
    const targetKey = pickStringByRendezvous(seed, `patch:route:${i}:target`, targetKeys);
    const targetIdx = remaining.findIndex((t) => t.key === targetKey);
    const target = remaining.splice(targetIdx, 1)[0]!;

    const ratio = 0.1 + rand(seed, `patch:route:${i}:amount`, 0) * 0.3;
    const amount = (target.max - target.min) * ratio;

    const polarity: ModulationRoute['polarity'] =
      rand(seed, `patch:route:${i}:polarity`, 0) < 0.8 ? 'unipolar' : 'bipolar';

    const smoothingRaw =
      DEFAULT_SMOOTHING + (rand(seed, `patch:route:${i}:smoothing`, 0) * 2 - 1) * 0.4;
    const smoothing = Math.min(1.6, Math.max(0.4, smoothingRaw));

    routes.push({
      source,
      target: target.key,
      amount,
      polarity,
      smoothing,
    });
  }

  return routes;
}

function withRoutes(patch: VisualPatch, defCatalog: ReturnType<typeof createCatalog>): VisualPatch {
  const routes = buildRoutes(patch.seed, patch.operators, defCatalog);
  const next = { ...patch, routes };
  // Safety: never return routes that invalidate the patch.
  if (validatePatch(next, defCatalog).length > 0) {
    return { ...patch, routes: [] };
  }
  return next;
}

/** seed から決定的に VisualPatch を組み立てる。 */
export function derivePatch(seed: string, opts: DeriveOptions): VisualPatch {
  const qualityTier: QualityTier = opts.qualityTier ?? 'medium';
  const gens = opts.catalog.all();
  const defCatalog = createCatalog(gens.map((g) => g.def));

  const pool: Record<GeneratorCategory, InlineGenerator[]> = {
    source: gens.filter((g) => g.def.category === 'source'),
    field: gens.filter((g) => g.def.category === 'field'),
    modifier: gens.filter((g) => g.def.category === 'modifier'),
    material: gens.filter((g) => g.def.category === 'material'),
  };

  // Counts within validate.ts limits, capped by available candidates.
  let sourceCount = Math.min(randInt(seed, 'patch:count:source', 0, 1, 2), pool.source.length);
  let fieldCount = Math.min(randInt(seed, 'patch:count:field', 0, 0, 2), pool.field.length);
  let modifierCount = Math.min(
    randInt(seed, 'patch:count:modifier', 0, 1, 3),
    pool.modifier.length,
  );
  const materialCount = Math.min(1, pool.material.length);

  if (sourceCount < 1) {
    throw new Error('derivePatch: need at least 1 source generator in catalog');
  }
  if (modifierCount < 1) {
    throw new Error('derivePatch: need at least 1 modifier generator in catalog');
  }
  if (materialCount < 1) {
    throw new Error('derivePatch: need at least 1 material generator in catalog');
  }

  const chosenIds = new Set<string>();
  // Stage order required by validate: Source → Field → Modifier → Material
  const sources = pickOperatorsForCategory(
    seed,
    'source',
    sourceCount,
    pool.source,
    chosenIds,
    'src',
    'source',
  );
  const fields = pickOperatorsForCategory(
    seed,
    'field',
    fieldCount,
    pool.field,
    chosenIds,
    'fld',
    'field',
  );
  const modifiers = pickOperatorsForCategory(
    seed,
    'modifier',
    modifierCount,
    pool.modifier,
    chosenIds,
    'mod',
    'modifier',
  );
  const materials = pickOperatorsForCategory(
    seed,
    'material',
    materialCount,
    pool.material,
    chosenIds,
    'mat',
    'material',
  );

  let operators: VisualOperator[] = [...sources, ...fields, ...modifiers, ...materials];
  const palette = buildPalette(seed);
  const composition = buildComposition(seed);

  let patch: VisualPatch = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    seed,
    operators,
    routes: [],
    palette,
    composition,
    qualityTier,
  };

  // Prefer full rolled counts; strip fields → extra modifiers → extra sources until in budget.
  // Routes stay empty during strip so validate only checks operators/budget.
  for (let attempt = 0; attempt < MAX_STRIP_ATTEMPTS; attempt++) {
    if (isValidInBudget(patch, defCatalog)) {
      return withRoutes(patch, defCatalog);
    }
    const next = stripOneOperator(patch.operators, defCatalog);
    if (!next) break;
    operators = next;
    patch = { ...patch, operators, routes: [] };
  }

  const validateIssues = validatePatch(patch, defCatalog);
  const budgetIssues = fitsBudget(estimateCost(patch, defCatalog), DEFAULT_BUDGETS[qualityTier]);
  throw new Error(
    `derivePatch: could not produce a valid in-budget patch for seed ${JSON.stringify(seed)} ` +
      `(validate=${validateIssues.length}, budget=${budgetIssues.length})`,
  );
}
