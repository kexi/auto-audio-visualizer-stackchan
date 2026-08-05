import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Seigaiha (青海波) — staggered overlapping concentric semicircle wave tiles.
 */
export const seigaihaDef: GeneratorDefinition = {
  id: 'seigaiha',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    culturalTexture: ['japan'],
    affect: ['calm', 'traditional'],
  },
  parameters: [
    {
      id: 'scale',
      label: 'Scale',
      kind: 'number',
      min: 2,
      max: 16,
      default: 6,
      modulatable: true,
    },
    {
      id: 'rings',
      label: 'Rings',
      kind: 'int',
      min: 2,
      max: 8,
      default: 4,
      modulatable: true,
    },
    {
      id: 'thickness',
      label: 'Thickness',
      kind: 'number',
      min: 0.01,
      max: 0.2,
      default: 0.06,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.55, stateful: false },
};

export const seigaihaGenerator: InlineGenerator = {
  def: seigaihaDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uScale = uniform('scale');
    const uRings = uniform('rings');
    const uThickness = uniform('thickness');
    return /* glsl */ `
// seigaiha source: staggered concentric semicircle wave tiles (青海波)
float ${fnName}(vec2 p) {
  float sc = clamp(${uScale}, 2.0, 16.0);
  int nRings = clamp(${uRings}, 2, 8);
  float th = clamp(${uThickness}, 0.01, 0.2);
  // tile space; odd rows staggered by 0.5
  vec2 gp = p * sc;
  float row = floor(gp.y);
  float stagger = mod(row, 2.0) * 0.5;
  float col = floor(gp.x - stagger);
  vec2 cellOrigin = vec2(col + stagger + 0.5, row);
  // also check neighbor tiles for overlap
  float d = 1e5;
  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      float r2 = row + float(oy);
      float st2 = mod(r2, 2.0) * 0.5;
      float c2 = floor(gp.x - st2) + float(ox);
      vec2 origin = vec2(c2 + st2 + 0.5, r2);
      vec2 local = gp - origin;
      // semicircle: upper half relative to tile (y up in cell)
      // center at bottom of tile
      vec2 center = vec2(0.0, -0.5);
      vec2 q = local - center;
      float rr = length(q);
      // only upper semicircle (q.y >= -small)
      float semi = step(-0.05, q.y);
      for (int k = 0; k < 8; k++) {
        if (k >= nRings) break;
        float rad = (float(k) + 1.0) / float(nRings) * 1.05;
        float dRing = abs(rr - rad);
        d = min(d, mix(1e5, dRing, semi));
      }
    }
  }
  float halfW = max(th * 0.5, 1e-4);
  float px = fwidth(d);
  float w = max(halfW, px * 0.75);
  return 1.0 - smoothstep(w - px, w + px, d);
}
`.trim();
  },
};
