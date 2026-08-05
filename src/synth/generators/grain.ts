import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Film grain — synthRand cell noise added to density, re-rolled every timeBucket.
 */
export const grainDef: GeneratorDefinition = {
  id: 'grain',
  version: 1,
  category: 'modifier',
  costClass: 'micro',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['film'],
    motion: ['flicker'],
    affect: ['nostalgic', 'tactile'],
  },
  parameters: [
    {
      id: 'amount',
      label: 'Amount',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.35,
      modulatable: true,
    },
    {
      id: 'size',
      label: 'Size',
      kind: 'number',
      min: 1,
      max: 8,
      default: 2,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.12, stateful: false },
};

export const grainGenerator: InlineGenerator = {
  def: grainDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uAmount = uniform('amount');
    const uSize = uniform('size');
    return /* glsl */ `
// grain value-modifier: per-cell synthRand noise, re-rolled per timeBucket (~24 Hz)
float ${fnName}(float v, vec2 p) {
  float amt = clamp(${uAmount}, 0.0, 1.0);
  float sz = clamp(${uSize}, 1.0, 8.0);
  // larger size => coarser grain
  vec2 cell = floor(p * (420.0 / sz));
  uint ch = synthHashCombine(uint(int(cell.x)), uint(int(cell.y)));
  uint timeBucket = uint(floor(uTime * 24.0));
  float r = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ch, timeBucket));
  float g = r * 2.0 - 1.0;
  float x = clamp(v, 0.0, 1.0);
  // keep the blacks mostly clean — grain rides on what is already lit
  return clamp(x + g * amt * 0.35 * (0.2 + 0.8 * x), 0.0, 1.0);
}
`.trim();
  },
};
