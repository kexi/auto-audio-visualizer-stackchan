import type { GeneratorCatalog } from './catalog';
import type { CostClass, QualityTier, RenderBudget, VisualPatch } from './types';
import type { ValidationIssue } from './validate';

export interface CostEstimate {
  total: number;
  passes: number;
  heavy: number;
  stateful: number;
}

const COST_WEIGHT: Record<CostClass, number> = {
  micro: 1,
  light: 3,
  medium: 10,
  heavy: 30,
};

const RESOLUTION_SCALE: Record<QualityTier, number> = {
  low: 0.5,
  medium: 0.75,
  high: 1.0,
};

/**
 * Default render budgets per quality tier.
 * - low:   tight (maxCost 50, maxPasses 2, no heavy, 1 stateful)
 * - medium: moderate headroom
 * - high:  room for heavier stacks
 */
export const DEFAULT_BUDGETS: Record<QualityTier, RenderBudget> = {
  low: {
    maxCost: 50,
    maxPasses: 2,
    maxHeavyGenerators: 0,
    maxStatefulGenerators: 1,
  },
  medium: {
    maxCost: 120,
    maxPasses: 4,
    maxHeavyGenerators: 1,
    maxStatefulGenerators: 2,
  },
  high: {
    maxCost: 250,
    maxPasses: 8,
    maxHeavyGenerators: 2,
    maxStatefulGenerators: 3,
  },
};

/**
 * Estimate cost of a patch.
 * operator cost = weight(costClass) × relativeFill × resolutionScale²
 * Missing catalog entries are skipped (validatePatch reports unknown generators).
 */
export function estimateCost(patch: VisualPatch, catalog: GeneratorCatalog): CostEstimate {
  const scale = RESOLUTION_SCALE[patch.qualityTier];
  const scaleSq = scale * scale;

  let total = 0;
  let passes = 0;
  let heavy = 0;
  let stateful = 0;

  for (const op of patch.operators) {
    const def = catalog.get(op.generatorId);
    if (!def) continue;

    const weight = COST_WEIGHT[def.costClass];
    total += weight * def.cost.relativeFill * scaleSq;
    passes += def.cost.passes;
    if (def.costClass === 'heavy') heavy += 1;
    if (def.cost.stateful) stateful += 1;
  }

  return { total, passes, heavy, stateful };
}

export function fitsBudget(estimate: CostEstimate, budget: RenderBudget): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (estimate.total > budget.maxCost) {
    issues.push({
      code: 'budget_cost',
      message: `total cost ${estimate.total} exceeds maxCost ${budget.maxCost}`,
      path: 'cost.total',
    });
  }
  if (estimate.passes > budget.maxPasses) {
    issues.push({
      code: 'budget_passes',
      message: `passes ${estimate.passes} exceeds maxPasses ${budget.maxPasses}`,
      path: 'cost.passes',
    });
  }
  if (estimate.heavy > budget.maxHeavyGenerators) {
    issues.push({
      code: 'budget_heavy',
      message: `heavy generators ${estimate.heavy} exceeds maxHeavyGenerators ${budget.maxHeavyGenerators}`,
      path: 'cost.heavy',
    });
  }
  if (estimate.stateful > budget.maxStatefulGenerators) {
    issues.push({
      code: 'budget_stateful',
      message: `stateful generators ${estimate.stateful} exceeds maxStatefulGenerators ${budget.maxStatefulGenerators}`,
      path: 'cost.stateful',
    });
  }

  return issues;
}
