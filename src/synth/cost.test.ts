import { describe, expect, it } from 'vitest';
import { createCatalog } from './catalog';
import { DEFAULT_BUDGETS, estimateCost, fitsBudget, type CostEstimate } from './cost';
import type { GeneratorDefinition, VisualPatch } from './types';

function makeDef(
  id: string,
  opts: {
    costClass: GeneratorDefinition['costClass'];
    relativeFill: number;
    passes: number;
    stateful: boolean;
    category?: GeneratorDefinition['category'];
  },
): GeneratorDefinition {
  return {
    id,
    version: 1,
    category: opts.category ?? 'source',
    costClass: opts.costClass,
    impl: opts.passes > 0 ? 'pass' : 'inline',
    output: opts.passes > 0 ? 'texture' : 'field',
    tags: {},
    parameters: [],
    cost: {
      passes: opts.passes,
      relativeFill: opts.relativeFill,
      stateful: opts.stateful,
    },
  };
}

const catalog = createCatalog([
  makeDef('micro-src', {
    costClass: 'micro',
    relativeFill: 1,
    passes: 0,
    stateful: false,
    category: 'source',
  }),
  makeDef('light-mod', {
    costClass: 'light',
    relativeFill: 2,
    passes: 0,
    stateful: false,
    category: 'modifier',
  }),
  makeDef('medium-field', {
    costClass: 'medium',
    relativeFill: 1,
    passes: 1,
    stateful: true,
    category: 'field',
  }),
  makeDef('heavy-mat', {
    costClass: 'heavy',
    relativeFill: 1.5,
    passes: 2,
    stateful: true,
    category: 'material',
  }),
]);

function patch(qualityTier: VisualPatch['qualityTier'], generatorIds: string[]): VisualPatch {
  return {
    schemaVersion: 1,
    seed: 'cost-seed',
    operators: generatorIds.map((generatorId, i) => ({
      id: `op${i}`,
      generatorId,
      generatorVersion: 1,
      parameters: {},
    })),
    routes: [],
    palette: { mode: 'mono', hueOffset: 0, saturation: 50, lightness: 50 },
    composition: { symmetry: 1, scale: 1, speed: 1 },
    qualityTier,
  };
}

describe('synth/cost', () => {
  describe('estimateCost', () => {
    it('qualityTier でコストが low < medium < high になる', () => {
      const ops = ['micro-src', 'light-mod'];
      const low = estimateCost(patch('low', ops), catalog);
      const medium = estimateCost(patch('medium', ops), catalog);
      const high = estimateCost(patch('high', ops), catalog);

      expect(low.total).toBeLessThan(medium.total);
      expect(medium.total).toBeLessThan(high.total);
    });

    it('weight × relativeFill × scale² で計算する', () => {
      // micro weight=1, relativeFill=1, high scale=1 → cost 1
      const high = estimateCost(patch('high', ['micro-src']), catalog);
      expect(high.total).toBeCloseTo(1);

      // low scale=0.5 → scale²=0.25 → cost 0.25
      const low = estimateCost(patch('low', ['micro-src']), catalog);
      expect(low.total).toBeCloseTo(0.25);

      // light weight=3, relativeFill=2, medium scale=0.75 → 3*2*0.5625 = 3.375
      const mediumLight = estimateCost(patch('medium', ['light-mod']), catalog);
      expect(mediumLight.total).toBeCloseTo(3.375);
    });

    it('heavy / stateful / passes を数える', () => {
      const est = estimateCost(patch('high', ['micro-src', 'medium-field', 'heavy-mat']), catalog);
      expect(est.heavy).toBe(1);
      expect(est.stateful).toBe(2); // medium-field + heavy-mat
      expect(est.passes).toBe(3); // 1 + 2
    });

    it('catalog に無い generator はスキップする', () => {
      const est = estimateCost(patch('high', ['micro-src', 'missing-gen']), catalog);
      expect(est.total).toBeCloseTo(1);
      expect(est.heavy).toBe(0);
      expect(est.passes).toBe(0);
    });
  });

  describe('fitsBudget', () => {
    it('予算内なら空配列', () => {
      const estimate: CostEstimate = {
        total: 10,
        passes: 1,
        heavy: 0,
        stateful: 0,
      };
      expect(fitsBudget(estimate, DEFAULT_BUDGETS.low)).toEqual([]);
    });

    it('maxCost 超過で budget_cost', () => {
      const estimate: CostEstimate = {
        total: 999,
        passes: 0,
        heavy: 0,
        stateful: 0,
      };
      const issues = fitsBudget(estimate, DEFAULT_BUDGETS.low);
      expect(issues.map((i) => i.code)).toContain('budget_cost');
    });

    it('maxPasses 超過で budget_passes', () => {
      const issues = fitsBudget(
        { total: 1, passes: 10, heavy: 0, stateful: 0 },
        DEFAULT_BUDGETS.low,
      );
      expect(issues.map((i) => i.code)).toContain('budget_passes');
    });

    it('maxHeavyGenerators 超過で budget_heavy', () => {
      const issues = fitsBudget(
        { total: 1, passes: 0, heavy: 2, stateful: 0 },
        DEFAULT_BUDGETS.low,
      );
      expect(issues.map((i) => i.code)).toContain('budget_heavy');
    });

    it('maxStatefulGenerators 超過で budget_stateful', () => {
      const issues = fitsBudget(
        { total: 1, passes: 0, heavy: 0, stateful: 5 },
        DEFAULT_BUDGETS.medium,
      );
      expect(issues.map((i) => i.code)).toContain('budget_stateful');
    });

    it('カスタム budget で判定できる', () => {
      const estimate = estimateCost(patch('high', ['heavy-mat']), catalog);
      // heavy: weight 30 * 1.5 * 1 = 45, passes 2, heavy 1, stateful 1
      expect(estimate.total).toBeCloseTo(45);
      expect(estimate.heavy).toBe(1);

      const tight = fitsBudget(estimate, {
        maxCost: 10,
        maxPasses: 0,
        maxHeavyGenerators: 0,
        maxStatefulGenerators: 0,
      });
      expect(tight.length).toBe(4);

      const loose = fitsBudget(estimate, {
        maxCost: 100,
        maxPasses: 8,
        maxHeavyGenerators: 2,
        maxStatefulGenerators: 3,
      });
      expect(loose).toEqual([]);
    });
  });

  describe('DEFAULT_BUDGETS', () => {
    it('low / medium / high が定義されている', () => {
      expect(DEFAULT_BUDGETS.low.maxCost).toBeLessThan(DEFAULT_BUDGETS.medium.maxCost);
      expect(DEFAULT_BUDGETS.medium.maxCost).toBeLessThan(DEFAULT_BUDGETS.high.maxCost);
      expect(DEFAULT_BUDGETS.low.maxHeavyGenerators).toBe(0);
    });
  });
});
