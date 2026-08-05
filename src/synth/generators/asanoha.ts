import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Asanoha (麻の葉) — hex grid with 6-ray star/leaf lines from each vertex.
 */
export const asanohaDef: GeneratorDefinition = {
  id: 'asanoha',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    culturalTexture: ['japan'],
    affect: ['geometric', 'traditional'],
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
      id: 'thickness',
      label: 'Thickness',
      kind: 'number',
      min: 0.004,
      max: 0.05,
      default: 0.012,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.5, stateful: false },
};

export const asanohaGenerator: InlineGenerator = {
  def: asanohaDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uScale = uniform('scale');
    const uThickness = uniform('thickness');
    return /* glsl */ `
// asanoha source: hex lattice with 6-ray star lines (麻の葉)
float ${fnName}(vec2 p) {
  float sc = clamp(${uScale}, 2.0, 16.0);
  float th = clamp(${uThickness}, 0.004, 0.05);
  // pointy-top hex axial-ish via rectangular offset rows
  float s3 = 0.86602540378;
  vec2 gp = p * sc;
  // hex size
  float hexH = 1.0;
  float hexW = s3;
  float row = floor(gp.y / (hexH * 0.75));
  float rowOff = mod(row, 2.0) * hexW * 0.5;
  float col = floor((gp.x - rowOff) / hexW);
  float d = 1e5;
  // check local hex centers (+ neighbors)
  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      float r = row + float(oy);
      float ro = mod(r, 2.0) * hexW * 0.5;
      float c = col + float(ox);
      vec2 center = vec2(c * hexW + ro + hexW * 0.5, r * hexH * 0.75 + hexH * 0.5);
      vec2 q = gp - center;
      float rlen = length(q);
      // clip to hex radius roughly
      if (rlen > hexH * 0.85) continue;
      // 3 diameters = 6 rays at 60 deg — star/leaf
      float ang = atan(q.y, q.x);
      // distance to nearest of 3 axes (0, 60, 120 deg)
      float a0 = abs(mod(ang + 3.14159265, 1.04719755) - 0.52359877);
      // also absolute distance along each diameter as line
      // line distance: |q · n_perp|
      for (int k = 0; k < 3; k++) {
        float a = float(k) * 1.04719755;
        vec2 dir = vec2(cos(a), sin(a));
        vec2 nrm = vec2(-dir.y, dir.x);
        float dLine = abs(dot(q, nrm));
        // only within hex radius segment
        float along = abs(dot(q, dir));
        if (along < hexH * 0.55) d = min(d, dLine);
      }
      // also connect midpoints of edges for classic asanoha subdivision
      // distance to lines from center to edge midpoints already covered by 6 rays
      // add outer hex edges
      float ha = abs(q.x) * s3 + abs(q.y) * 0.5;
      float hb = abs(q.y);
      float hexEdge = max(ha, hb) - hexH * 0.5;
      d = min(d, abs(hexEdge));
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
