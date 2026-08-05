import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Checkerboard (市松) — alternating squares with fwidth-AA edges plus optional extra softness.
 */
export const checkerDef: GeneratorDefinition = {
  id: 'checker',
  version: 1,
  category: 'source',
  costClass: 'micro',
  impl: 'inline',
  output: 'field',
  tags: {
    culturalTexture: ['japan'],
    affect: ['graphic', 'traditional'],
  },
  parameters: [
    {
      id: 'scale',
      label: 'Scale',
      kind: 'number',
      min: 2,
      max: 40,
      default: 10,
      modulatable: true,
    },
    {
      id: 'softness',
      label: 'Softness',
      kind: 'number',
      min: 0,
      max: 0.5,
      default: 0.05,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.15, stateful: false },
};

export const checkerGenerator: InlineGenerator = {
  def: checkerDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uScale = uniform('scale');
    const uSoftness = uniform('softness');
    return /* glsl */ `
// checker source: 市松 via sign of sin(pi x) * sin(pi y), fwidth-AA
float ${fnName}(vec2 p) {
  float sc = clamp(${uScale}, 2.0, 40.0);
  float soft = clamp(${uSoftness}, 0.0, 0.5);
  vec2 gp = p * sc;
  // product of the two half-period sines is positive on one square set, negative on the other
  float t = sin(3.14159265359 * gp.x) * sin(3.14159265359 * gp.y);
  float px = max(fwidth(t), 1e-5);
  float edge = max(px, soft);
  return smoothstep(-edge, edge, t);
}
`.trim();
  },
};
