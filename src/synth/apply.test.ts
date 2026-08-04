import { describe, expect, it } from 'vitest';
import { gatePatchProposal } from './apply';
import { createCatalog } from './catalog';
import { DEFAULT_BUDGETS } from './cost';
import type { GeneratorDefinition, VisualPatch } from './types';

function def(
  partial: Partial<GeneratorDefinition> & Pick<GeneratorDefinition, 'id' | 'category'>,
): GeneratorDefinition {
  return {
    version: 1,
    costClass: 'light',
    impl: 'inline',
    output: partial.category === 'material' ? 'color' : 'field',
    tags: {},
    parameters: [
      {
        id: 'amount',
        label: 'Amount',
        kind: 'number',
        min: 0,
        max: 1,
        default: 0.5,
        modulatable: true,
      },
      {
        id: 'mode',
        label: 'Mode',
        kind: 'enum',
        options: ['a', 'b'],
        default: 'a',
        modulatable: false,
      },
      {
        id: 'count',
        label: 'Count',
        kind: 'int',
        min: 1,
        max: 8,
        default: 2,
        modulatable: true,
      },
      {
        id: 'enabled',
        label: 'Enabled',
        kind: 'bool',
        default: true,
        modulatable: false,
      },
    ],
    cost: { passes: 0, relativeFill: 1, stateful: false },
    ...partial,
  };
}

const catalog = createCatalog([
  def({ id: 'gen-source', category: 'source' }),
  def({ id: 'gen-modifier', category: 'modifier' }),
  def({ id: 'gen-material', category: 'material', output: 'color' }),
  def({
    id: 'heavy-mat',
    category: 'material',
    output: 'color',
    costClass: 'heavy',
    cost: { passes: 2, relativeFill: 10, stateful: true },
  }),
]);

function validPatch(overrides: Partial<VisualPatch> = {}): VisualPatch {
  return {
    schemaVersion: 1,
    seed: 'seed',
    operators: [
      {
        id: 'src',
        generatorId: 'gen-source',
        generatorVersion: 1,
        parameters: { amount: 0.5, mode: 'a', count: 2, enabled: true },
      },
      {
        id: 'mod',
        generatorId: 'gen-modifier',
        generatorVersion: 1,
        parameters: { amount: 0.3, mode: 'b', count: 1, enabled: false },
      },
      {
        id: 'mat',
        generatorId: 'gen-material',
        generatorVersion: 1,
        parameters: { amount: 1, mode: 'a', count: 4, enabled: true },
      },
    ],
    routes: [
      {
        source: 'audio:bass',
        target: 'mod.amount',
        amount: 0.5,
        polarity: 'unipolar',
        smoothing: 0.1,
      },
    ],
    palette: { mode: 'mono', hueOffset: 0, saturation: 50, lightness: 50 },
    composition: { symmetry: 1, scale: 1, speed: 1 },
    qualityTier: 'medium',
    ...overrides,
  };
}

describe('synth/apply gatePatchProposal', () => {
  it('schema invalid → schema stage issues, ok false', () => {
    const result = gatePatchProposal({ not: 'a patch' }, catalog, DEFAULT_BUDGETS.medium);
    expect(result.ok).toBe(false);
    expect(result.patch).toBeUndefined();
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((i) => i.code === 'schema')).toBe(true);
  });

  it('graph violation (unknown generatorId) → validate issues', () => {
    const input = validPatch({
      operators: [
        {
          id: 'src',
          generatorId: 'unknown-gen',
          generatorVersion: 1,
          parameters: { amount: 0.5, mode: 'a', count: 2, enabled: true },
        },
        {
          id: 'mod',
          generatorId: 'gen-modifier',
          generatorVersion: 1,
          parameters: { amount: 0.3, mode: 'b', count: 1, enabled: false },
        },
        {
          id: 'mat',
          generatorId: 'gen-material',
          generatorVersion: 1,
          parameters: { amount: 1, mode: 'a', count: 4, enabled: true },
        },
      ],
    });
    const result = gatePatchProposal(input, catalog, DEFAULT_BUDGETS.medium);
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.code === 'schema')).toBe(false);
    // validate stage — unknown generator
    expect(result.issues.some((i) => /unknown|generator/i.test(i.message + i.code))).toBe(true);
  });

  it('budget exceed → fitsBudget issues', () => {
    const input = validPatch({
      qualityTier: 'low',
      operators: [
        {
          id: 'src',
          generatorId: 'gen-source',
          generatorVersion: 1,
          parameters: { amount: 0.5, mode: 'a', count: 2, enabled: true },
        },
        {
          id: 'mod',
          generatorId: 'gen-modifier',
          generatorVersion: 1,
          parameters: { amount: 0.3, mode: 'b', count: 1, enabled: false },
        },
        {
          id: 'mat',
          generatorId: 'heavy-mat',
          generatorVersion: 1,
          parameters: { amount: 1, mode: 'a', count: 4, enabled: true },
        },
      ],
    });
    // DEFAULT_BUDGETS.low: maxHeavyGenerators: 0, maxStatefulGenerators: 1
    const result = gatePatchProposal(input, catalog, DEFAULT_BUDGETS.low);
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.code.startsWith('budget_'))).toBe(true);
  });

  it('valid patch → ok true with patch', () => {
    const input = validPatch();
    const result = gatePatchProposal(input, catalog, DEFAULT_BUDGETS.medium);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.patch).toBeDefined();
    expect(result.patch!.seed).toBe('seed');
    expect(result.patch!.operators).toHaveLength(3);
  });
});
