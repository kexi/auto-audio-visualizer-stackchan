import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Radial sine displacement field from center (ripple waves).
 * Assembler multiplies return value by amount.
 */
export const rippleDef: GeneratorDefinition = {
  id: 'ripple',
  version: 1,
  category: 'field',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    motion: ['wave', 'ripple'],
    material: ['fluid'],
    affect: ['liquid'],
  },
  parameters: [
    {
      id: 'freq',
      label: 'Freq',
      kind: 'number',
      min: 1,
      max: 30,
      default: 8,
      modulatable: true,
    },
    {
      id: 'speed',
      label: 'Speed',
      kind: 'number',
      min: 0,
      max: 3,
      default: 1,
      modulatable: true,
    },
    {
      id: 'amount',
      label: 'Amount',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.15,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.3, stateful: false },
};

export const rippleGenerator: InlineGenerator = {
  def: rippleDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uFreq = uniform('freq');
    const uSpeed = uniform('speed');
    return /* glsl */ `
// ripple field: radial sine displacement (amount applied in main)
vec2 ${fnName}(vec2 p) {
  float r = length(p);
  vec2 dir = r > 1e-5 ? p / r : vec2(0.0);
  float freq = max(${uFreq}, 1.0);
  float phase = r * freq - uTime * max(${uSpeed}, 0.0);
  return dir * sin(phase);
}
`.trim();
  },
};
