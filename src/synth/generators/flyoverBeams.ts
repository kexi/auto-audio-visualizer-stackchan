import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Overpass beam fragments — thick horizontals + diagonal braces, slow scroll.
 */
export const flyoverBeamsDef: GeneratorDefinition = {
  id: 'flyoverBeams',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    environment: ['urban'],
    affect: ['infrastructural', 'heavy', 'cinematic'],
  },
  parameters: [
    {
      id: 'spacing',
      label: 'Spacing',
      kind: 'number',
      min: 0.1,
      max: 1,
      default: 0.35,
      modulatable: true,
    },
    {
      id: 'diagonal',
      label: 'Diagonal',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.5,
      modulatable: true,
    },
    {
      id: 'scroll',
      label: 'Scroll',
      kind: 'number',
      min: 0,
      max: 2,
      default: 0.25,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.5, stateful: false },
};

export const flyoverBeamsGenerator: InlineGenerator = {
  def: flyoverBeamsDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uSpacing = uniform('spacing');
    const uDiagonal = uniform('diagonal');
    const uScroll = uniform('scroll');
    return /* glsl */ `
// flyoverBeams source: fragmented overpass beams + braces with perspective
float ${fnName}(vec2 p) {
  float sp = clamp(${uSpacing}, 0.1, 1.0);
  float diagAmt = clamp(${uDiagonal}, 0.0, 1.0);
  float scr = max(${uScroll}, 0.0);
  float scrollX = uTime * scr * 0.12;
  // perspective packing: denser near top (far)
  float depth = clamp(p.y * 0.5 + 0.5, 0.0, 1.0);
  float pack = mix(1.0, 2.2, depth);
  float qy = p.y * pack;
  float qx = p.x + scrollX;
  float dens = 0.0;
  // horizontal beams (fragments only)
  float pitchY = max(sp * 1.8, 0.12);
  float row = floor(qy / pitchY);
  float fy = fract(qy / pitchY);
  uint ridx = uint(int(row));
  float present = step(0.28, synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ridx, 1u)));
  float x0 = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ridx, 2u)) * 1.6 - 0.8;
  float x1 = x0 + 0.35 + 0.9 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ridx, 3u));
  float inSeg = step(x0, qx) * step(qx, x1);
  float halfBh = max(0.018 * mix(1.2, 0.7, depth), 1e-4);
  float dBeam = abs(fy - 0.5) * pitchY;
  float pxB = fwidth(dBeam);
  float wB = max(halfBh, pxB * 0.75);
  float beam = (1.0 - smoothstep(wB - pxB, wB + pxB, dBeam)) * present * inSeg;
  dens = max(dens, beam);
  // diagonal braces
  for (int i = 0; i < 8; i++) {
    uint idx = uint(i);
    float use = step(1.0 - diagAmt * 0.85 - 0.1, synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 10u)));
    if (use < 0.5) continue;
    float yC = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 11u)) - 0.5) * 1.6;
    float xC = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 12u)) - 0.5) * 2.0 + scrollX * 0.5;
    float ang = mix(-0.7, 0.7, synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 13u)));
    float ca = cos(ang);
    float sa = sin(ang);
    vec2 dlt = vec2(qx - xC, p.y - yC);
    float along = dlt.x * ca + dlt.y * sa;
    float perp = abs(-dlt.x * sa + dlt.y * ca);
    float segLen = 0.2 + 0.45 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 14u));
    float onSeg = step(abs(along), segLen);
    float halfW = max(0.01, 1e-4);
    float px = fwidth(perp);
    float w = max(halfW, px * 0.75);
    float brace = (1.0 - smoothstep(w - px, w + px, perp)) * onSeg * use;
    dens = max(dens, brace * 0.9);
  }
  return clamp(dens, 0.0, 1.0);
}
`.trim();
  },
};
