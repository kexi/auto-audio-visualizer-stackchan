import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Typhoon shear field — height-weighted horizontal flow with reverse pockets and gusts.
 * Assembler multiplies return value by amount.
 */
export const typhoonShearDef: GeneratorDefinition = {
  id: 'typhoonShear',
  version: 1,
  category: 'field',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    affect: ['ominous', 'tropical', 'tense'],
  },
  parameters: [
    {
      id: 'strength',
      label: 'Strength',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'gustRate',
      label: 'Gust Rate',
      kind: 'number',
      min: 0.1,
      max: 2,
      default: 0.4,
      modulatable: true,
    },
    {
      id: 'amount',
      label: 'Amount',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.2,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.3, stateful: false },
};

export const typhoonShearGenerator: InlineGenerator = {
  def: typhoonShearDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uStrength = uniform('strength');
    const uGustRate = uniform('gustRate');
    const vnoise = `${fnName}_vnoise`;
    return /* glsl */ `
// typhoonShear field: height shear + reverse pockets + gusts (amount in main)
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
vec2 ${fnName}(vec2 p) {
  float str = clamp(${uStrength}, 0.0, 1.0);
  float gRate = max(${uGustRate}, 0.1);
  // stronger horizontal shear at top
  float hW = smoothstep(-0.6, 0.7, p.y);
  // long-period strength breathing
  float breath = 0.65 + 0.35 * sin(uTime * 0.18);
  // local reverse-flow pockets
  float n = ${vnoise}(p * 2.2 + vec2(uTime * 0.05, 0.0));
  float reverse = smoothstep(0.55, 0.75, n) * 2.0 - 0.0;
  float dir = mix(1.0, -1.0, reverse * 0.85);
  // occasional gust via timeBucket
  uint timeBucket = uint(floor(uTime * gRate));
  float gustR = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(timeBucket, 9u));
  float gust = step(0.78, gustR) * (0.6 + 0.8 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(timeBucket, 10u)));
  float mag = str * hW * breath * (0.7 + 0.5 * n) + gust * str;
  float dx = dir * mag;
  float dy = (n - 0.5) * 0.15 * str * hW;
  return vec2(dx, dy);
}
`.trim();
  },
};
