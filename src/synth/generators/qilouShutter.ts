import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Qilou accordion shutter — dense vertical ribs with wear and stuck sections.
 */
export const qilouShutterDef: GeneratorDefinition = {
  id: 'qilouShutter',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    culturalTexture: ['taiwan-streetscape'],
    environment: ['urban'],
    affect: ['nostalgic', 'restrained'],
  },
  parameters: [
    {
      id: 'density',
      label: 'Density',
      kind: 'number',
      min: 8,
      max: 64,
      default: 32,
      modulatable: true,
    },
    {
      id: 'openness',
      label: 'Openness',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.35,
      modulatable: true,
    },
    {
      id: 'wear',
      label: 'Wear',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.4,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.55, stateful: false },
};

export const qilouShutterGenerator: InlineGenerator = {
  def: qilouShutterDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uDensity = uniform('density');
    const uOpenness = uniform('openness');
    const uWear = uniform('wear');
    const vnoise = `${fnName}_vnoise`;
    return /* glsl */ `
// qilouShutter source: dense vertical accordion ribs with wear/stuck gaps
float ${vnoise}(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  int ix = int(i.x);
  int iy = int(i.y);
  float a = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(ix), uint(iy)));
  float b = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(ix + 1), uint(iy)));
  float c = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(ix), uint(iy + 1)));
  float d = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(ix + 1), uint(iy + 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float ${fnName}(vec2 p) {
  float dens = clamp(${uDensity}, 8.0, 64.0);
  float open = clamp(${uOpenness}, 0.0, 1.0);
  float wearAmt = clamp(${uWear}, 0.0, 1.0);
  // slow open/close breathing
  float breath = 0.5 + 0.5 * sin(uTime * 0.35);
  float openEff = clamp(open * (0.75 + 0.25 * breath), 0.0, 1.0);
  // low-freq noise modulates rib width/gap
  float n = ${vnoise}(vec2(p.x * 1.6, p.y * 0.4 + uTime * 0.02));
  float localDens = dens * (0.85 + 0.3 * n);
  float gx = p.x * localDens;
  float ribIdx = floor(gx);
  float fx = fract(gx);
  uint ridx = uint(int(ribIdx));
  // every few ribs: fold/sink/half-open gap
  float foldRoll = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ridx, 3u));
  float gapBoost = 0.0;
  if (foldRoll < 0.12) {
    gapBoost = 0.35 + 0.4 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ridx, 4u));
  } else if (foldRoll < 0.22) {
    gapBoost = 0.15 + 0.2 * openEff;
  }
  // occasional stuck section via timeBucket
  uint timeBucket = uint(floor(uTime * 0.25));
  float stuck = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ridx, timeBucket));
  float stuckOpen = step(0.92, stuck) * (0.3 + 0.5 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ridx, 7u)));
  float openLocal = clamp(openEff + stuckOpen, 0.0, 0.95);
  // rib half-width shrinks with openness; wear thins randomly
  float wearR = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ridx, 5u));
  float halfW = max(0.5 * (1.0 - openLocal - gapBoost) * (1.0 - wearAmt * 0.45 * wearR), 0.02);
  float md = abs(fx - 0.5);
  float d = md;
  // wear: faint horizontal score marks
  float score = ${vnoise}(vec2(p.x * 0.5, p.y * 18.0));
  float scoreLine = smoothstep(0.62, 0.72, score) * wearAmt * 0.35;
  float px = fwidth(d);
  float w = max(halfW, px * 0.75);
  float rib = 1.0 - smoothstep(w - px, w + px, d);
  return clamp(max(rib, scoreLine * rib * 0.5 + scoreLine * 0.15), 0.0, 1.0);
}
`.trim();
  },
};
