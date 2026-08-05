import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Uroko (鱗紋) — staggered rows of overlapping semicircular scales: rim plus soft body.
 */
export const urokoDef: GeneratorDefinition = {
  id: 'uroko',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    culturalTexture: ['japan'],
    affect: ['traditional', 'tactile'],
  },
  parameters: [
    {
      id: 'scale',
      label: 'Scale',
      kind: 'number',
      min: 2,
      max: 24,
      default: 8,
      modulatable: true,
    },
    {
      id: 'overlap',
      label: 'Overlap',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.5,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.55, stateful: false },
};

export const urokoGenerator: InlineGenerator = {
  def: urokoDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uScale = uniform('scale');
    const uOverlap = uniform('overlap');
    return /* glsl */ `
// uroko source: staggered semicircular scales (鱗紋) — rim line over a soft body
float ${fnName}(vec2 p) {
  float sc = clamp(${uScale}, 2.0, 24.0);
  float ov = clamp(${uOverlap}, 0.0, 1.0);
  // tighter rows = more overlap
  float rowH = mix(0.95, 0.5, ov);
  vec2 gp = vec2(p.x * sc, p.y * sc / rowH);
  float row = floor(gp.y);
  float rim = 1e5;
  float body = 0.0;
  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      float r2 = row + float(oy);
      float st2 = mod(r2, 2.0) * 0.5;
      float c2 = floor(gp.x - st2) + float(ox);
      vec2 center = vec2(c2 + st2 + 0.5, r2);
      // back to isotropic units so scales stay round
      vec2 q = (gp - center) * vec2(1.0, rowH);
      float rr = length(q);
      // upper semicircle only
      float semi = step(0.0, q.y);
      rim = min(rim, mix(1e5, abs(rr - 0.5), semi));
      float inside = (1.0 - smoothstep(0.34, 0.5, rr)) * semi;
      body = max(body, inside);
    }
  }
  float halfW = max(0.045 * rowH, 1e-4);
  float px = fwidth(rim);
  float w = max(halfW, px * 0.75);
  float line = 1.0 - smoothstep(w - px, w + px, rim);
  return clamp(max(line, body * 0.4), 0.0, 1.0);
}
`.trim();
  },
};
