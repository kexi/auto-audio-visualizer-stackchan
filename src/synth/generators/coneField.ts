import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Speaker cone field — circular push/pull regions expand/contract coords.
 * Assembler multiplies return value by amount.
 */
export const coneFieldDef: GeneratorDefinition = {
  id: 'coneField',
  version: 1,
  category: 'field',
  costClass: 'medium',
  impl: 'inline',
  output: 'vector',
  tags: {
    environment: ['club'],
    material: ['speaker'],
    affect: ['physical', 'dense'],
  },
  parameters: [
    {
      id: 'cones',
      label: 'Cones',
      kind: 'int',
      min: 1,
      max: 5,
      default: 3,
      modulatable: true,
    },
    {
      id: 'size',
      label: 'Size',
      kind: 'number',
      min: 0.1,
      max: 0.6,
      default: 0.3,
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
  cost: { passes: 0, relativeFill: 0.45, stateful: false },
};

export const coneFieldGenerator: InlineGenerator = {
  def: coneFieldDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uCones = uniform('cones');
    const uSize = uniform('size');
    return /* glsl */ `
// coneField field: multi cone radial push/pull (amount applied in main)
vec2 ${fnName}(vec2 p) {
  int n = clamp(${uCones}, 1, 5);
  float sz = clamp(${uSize}, 0.1, 0.6);
  vec2 disp = vec2(0.0);
  for (int i = 0; i < 5; i++) {
    if (i >= n) break;
    uint idx = uint(i);
    float cx = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 1u)) - 0.5) * 1.6;
    float cy = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 2u)) - 0.5) * 1.6;
    vec2 c = vec2(cx, cy);
    float phase = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 3u)) * 6.28318530718;
    // bass-friendly slow pulse
    float pulse = sin(uTime * (1.2 + 0.6 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 4u))) + phase);
    float rad = sz * (0.75 + 0.35 * pulse);
    vec2 d = p - c;
    float r = length(d);
    float fall = exp(-r * r / max(rad * rad * 2.0, 1e-4));
    // push outward on positive pulse, pull on negative
    vec2 dir = d / max(r, 1e-4);
    disp += dir * fall * pulse * 0.85;
  }
  return disp;
}
`.trim();
  },
};
