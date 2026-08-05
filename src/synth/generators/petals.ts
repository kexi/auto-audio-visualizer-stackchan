import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Petals (花弁) — centre-symmetric lobes from an angular cosine times a radial falloff.
 */
export const petalsDef: GeneratorDefinition = {
  id: 'petals',
  version: 1,
  category: 'source',
  costClass: 'micro',
  impl: 'inline',
  output: 'field',
  tags: {
    culturalTexture: ['japan'],
    motion: ['breathe'],
    affect: ['soft', 'ornate'],
  },
  parameters: [
    {
      id: 'count',
      label: 'Count',
      kind: 'int',
      min: 3,
      max: 16,
      default: 6,
      modulatable: true,
    },
    {
      id: 'size',
      label: 'Size',
      kind: 'number',
      min: 0.2,
      max: 1,
      default: 0.62,
      modulatable: true,
    },
    {
      id: 'softness',
      label: 'Softness',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.35,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.3, stateful: false },
};

export const petalsGenerator: InlineGenerator = {
  def: petalsDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uCount = uniform('count');
    const uSize = uniform('size');
    const uSoftness = uniform('softness');
    return /* glsl */ `
// petals source: angular cosine lobes bounded by a radial edge, breathing slowly
float ${fnName}(vec2 p) {
  float k = float(clamp(${uCount}, 3, 16));
  float size = clamp(${uSize}, 0.2, 1.0);
  float soft = clamp(${uSoftness}, 0.0, 1.0);
  float rad = length(p);
  float ang = atan(p.y, p.x) + uTime * 0.08;
  // k lobes in 0..1
  float lobe = 0.5 + 0.5 * cos(ang * k);
  // slow open/close
  float breath = 0.94 + 0.06 * sin(uTime * 0.5);
  float rEdge = size * breath * (0.22 + 0.78 * lobe);
  float d = rad - rEdge;
  float px = max(fwidth(d), 1e-5);
  float w = max(px, soft * 0.22 * size);
  float body = 1.0 - smoothstep(-w, w, d);
  // brighter toward the petal spine, dimmer in the notches
  float spine = mix(0.65, 1.0, lobe);
  return clamp(body * spine, 0.0, 1.0);
}
`.trim();
  },
};
