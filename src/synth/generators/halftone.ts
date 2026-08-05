import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Classic halftone — map density to dot size in rotated cells; fwidth AA.
 */
export const halftoneDef: GeneratorDefinition = {
  id: 'halftone',
  version: 1,
  category: 'modifier',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['print'],
    affect: ['graphic', 'nostalgic'],
  },
  parameters: [
    {
      id: 'cellScale',
      label: 'Cell Scale',
      kind: 'number',
      min: 20,
      max: 160,
      default: 48,
      modulatable: true,
    },
    {
      id: 'angle',
      label: 'Angle',
      kind: 'number',
      min: 0,
      max: 90,
      default: 22,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.25, stateful: false },
};

export const halftoneGenerator: InlineGenerator = {
  def: halftoneDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uCellScale = uniform('cellScale');
    const uAngle = uniform('angle');
    return /* glsl */ `
// halftone value-modifier: rotated-cell dots sized by density, fwidth AA
float ${fnName}(float v, vec2 p) {
  float sc = clamp(${uCellScale}, 20.0, 160.0);
  float ang = clamp(${uAngle}, 0.0, 90.0) * 0.01745329251;
  float c = cos(ang);
  float s = sin(ang);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y) * sc;
  vec2 f = fract(q) - 0.5;
  float dens = clamp(v, 0.0, 1.0);
  // radius grows with density (classic AM halftone)
  float rad = dens * 0.72;
  float d = length(f);
  float aa = max(fwidth(d), 1e-4);
  float dot = 1.0 - smoothstep(rad - aa, rad + aa, d);
  return clamp(dot, 0.0, 1.0);
}
`.trim();
  },
};
