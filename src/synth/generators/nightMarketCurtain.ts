import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Night-market vinyl noren strips — uneven spacing, wind sway, ragged bottoms.
 */
export const nightMarketCurtainDef: GeneratorDefinition = {
  id: 'nightMarketCurtain',
  version: 1,
  category: 'source',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['vinyl-curtain'],
    affect: ['humid', 'nocturnal', 'intimate'],
  },
  parameters: [
    {
      id: 'strips',
      label: 'Strips',
      kind: 'number',
      min: 4,
      max: 24,
      default: 10,
      modulatable: true,
    },
    {
      id: 'unevenness',
      label: 'Unevenness',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.45,
      modulatable: true,
    },
    {
      id: 'swayAmt',
      label: 'Sway',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.35,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.4, stateful: false },
};

export const nightMarketCurtainGenerator: InlineGenerator = {
  def: nightMarketCurtainDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uStrips = uniform('strips');
    const uUneven = uniform('unevenness');
    const uSway = uniform('swayAmt');
    return /* glsl */ `
// nightMarketCurtain source: uneven vinyl noren strips with per-strip sway
float ${fnName}(vec2 p) {
  int n = clamp(int(${uStrips}), 4, 24);
  float uneven = clamp(${uUneven}, 0.0, 1.0);
  float sway = clamp(${uSway}, 0.0, 1.0);
  float x01 = clamp(p.x * 0.5 + 0.5, 0.0, 1.0);
  // total width mass for normalization
  float sumW = 0.0;
  for (int i = 0; i < 24; i++) {
    if (i >= n) break;
    float rw = 0.55 + 0.9 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(i), 1u));
    rw = mix(1.0, rw, uneven);
    sumW += rw;
  }
  sumW = max(sumW, 1e-4);
  float dens = 0.0;
  float edgeD = 1e5;
  float left = 0.0;
  for (int i = 0; i < 24; i++) {
    if (i >= n) break;
    float rw = 0.55 + 0.9 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(i), 1u));
    rw = mix(1.0, rw, uneven);
    float wNorm = rw / sumW;
    float right = left + wNorm;
    float phase = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(i), 2u)) * 6.28318530718;
    float heightW = smoothstep(-0.2, 0.85, -p.y);
    float spd = 0.7 + 0.5 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(i), 3u));
    float dx = sin(uTime * spd + phase + p.y * 2.5) * sway * 0.04 * heightW;
    float xl = left + dx;
    float xr = right + dx;
    float botR = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(i), 4u));
    float bottom = mix(-0.95, -0.55, botR * uneven + (1.0 - uneven) * 0.35);
    bottom += sin(uTime * 0.4 + phase) * sway * 0.03;
    float inX = step(xl, x01) * step(x01, xr);
    float inY = step(bottom, p.y) * step(p.y, 1.05);
    float body = inX * inY * 0.72;
    float dL = abs(x01 - xl);
    float dR = abs(x01 - xr);
    float dEdge = min(dL, dR);
    edgeD = min(edgeD, mix(1e5, dEdge, inY));
    dens = max(dens, body);
    left = right;
  }
  float halfW = 0.004;
  float px = fwidth(edgeD);
  float w = max(halfW, px * 0.75);
  float edge = 1.0 - smoothstep(w - px, w + px, edgeD);
  return clamp(max(dens * 0.85, edge), 0.0, 1.0);
}
`.trim();
  },
};
