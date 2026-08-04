import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Deterministic grid dropout — zero density in cells where synthRand < amount.
 */
export const dropoutDef: GeneratorDefinition = {
  id: 'dropout',
  version: 1,
  category: 'modifier',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['glitch', 'sparse'],
    motion: ['flicker'],
    affect: ['broken', 'digital'],
  },
  parameters: [
    {
      id: 'amount',
      label: 'Amount',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.25,
      modulatable: true,
    },
    {
      id: 'scale',
      label: 'Scale',
      kind: 'number',
      min: 1,
      max: 64,
      default: 16,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.15, stateful: false },
};

export const dropoutGenerator: InlineGenerator = {
  def: dropoutDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uAmount = uniform('amount');
    const uScale = uniform('scale');
    return /* glsl */ `
// dropout value-modifier: deterministic cell kill via synthRand
float ${fnName}(float v, vec2 p) {
  float sc = max(${uScale}, 1.0);
  float amt = clamp(${uAmount}, 0.0, 1.0);
  vec2 c = floor(p * sc);
  int ix = int(c.x);
  int iy = int(c.y);
  float r = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(ix), uint(iy)));
  if (r < amt) {
    return 0.0;
  }
  return v;
}
`.trim();
  },
};
