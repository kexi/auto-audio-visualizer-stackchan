import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Center rotation over time with light angular wobble.
 */
export const spinDef: GeneratorDefinition = {
  id: 'spin',
  version: 1,
  category: 'modifier',
  costClass: 'micro',
  impl: 'inline',
  output: 'vector',
  tags: {
    material: ['geometric'],
    affect: ['hypnotic', 'kinetic'],
  },
  parameters: [
    {
      id: 'rate',
      label: 'Rate',
      kind: 'number',
      min: -2,
      max: 2,
      default: 0.4,
      modulatable: true,
    },
    {
      id: 'wobble',
      label: 'Wobble',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.2,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.05, stateful: false },
};

export const spinGenerator: InlineGenerator = {
  def: spinDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uRate = uniform('rate');
    const uWobble = uniform('wobble');
    return /* glsl */ `
// spin coord-modifier: center rotation + light wobble
vec2 ${fnName}(vec2 p) {
  float rate = clamp(${uRate}, -2.0, 2.0);
  float wob = clamp(${uWobble}, 0.0, 1.0);
  float ang = rate * uTime + wob * 0.35 * sin(uTime * 2.3 + length(p) * 3.0);
  float c = cos(ang);
  float s = sin(ang);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
`.trim();
  },
};
