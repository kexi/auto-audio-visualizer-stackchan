import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Radial breath scale pulse. Returns displacement toward/away from origin.
 * Assembler multiplies return value by amount.
 */
export const pulseDef: GeneratorDefinition = {
  id: 'pulse',
  version: 1,
  category: 'field',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    motion: ['pulse', 'breath'],
    affect: ['alive'],
  },
  parameters: [
    {
      id: 'rate',
      label: 'Rate',
      kind: 'number',
      min: 0.1,
      max: 4,
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
  cost: { passes: 0, relativeFill: 0.15, stateful: false },
};

export const pulseGenerator: InlineGenerator = {
  def: pulseDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uRate = uniform('rate');
    return /* glsl */ `
// pulse field: radial breath scale as origin-centered displacement
vec2 ${fnName}(vec2 p) {
  float rate = max(${uRate}, 0.1);
  float s = sin(uTime * rate * 6.28318530718);
  return p * s * 0.5;
}
`.trim();
  },
};
