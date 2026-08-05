import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Height-weighted horizontal sway (wind / noren curtain).
 * Assembler multiplies return value by amount.
 */
export const swayDef: GeneratorDefinition = {
  id: 'sway',
  version: 1,
  category: 'field',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    motion: ['sway'],
    affect: ['humid'],
    material: ['vinyl-curtain'],
  },
  parameters: [
    {
      id: 'freq',
      label: 'Freq',
      kind: 'number',
      min: 0.5,
      max: 8,
      default: 2,
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
      default: 0.2,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.2, stateful: false },
};

export const swayGenerator: InlineGenerator = {
  def: swayDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uFreq = uniform('freq');
    const uSpeed = uniform('speed');
    return /* glsl */ `
// sway field: height-weighted horizontal wind (amount applied in main)
vec2 ${fnName}(vec2 p) {
  float freq = max(${uFreq}, 0.5);
  float heightWeight = smoothstep(-0.5, 0.5, p.y);
  float dx = sin(p.y * freq + uTime * max(${uSpeed}, 0.0)) * heightWeight;
  return vec2(dx, 0.0);
}
`.trim();
  },
};
