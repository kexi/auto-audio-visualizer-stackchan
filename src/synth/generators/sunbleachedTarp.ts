import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Sun-bleached tarp — washed-out blue, hard light/dark only on the folds,
 * chalky white patches and a very fine orthogonal weave.
 * Returns premultiplied alpha.
 */
export const sunbleachedTarpDef: GeneratorDefinition = {
  id: 'sunbleachedTarp',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    material: ['tarp'],
    environment: ['urban'],
    affect: ['provisional', 'weathered', 'local'],
  },
  parameters: [
    {
      id: 'fade',
      label: 'Fade',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'creases',
      label: 'Creases',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.5,
      modulatable: true,
    },
    {
      id: 'weave',
      label: 'Weave',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.4,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.45, stateful: false },
};

export const sunbleachedTarpGenerator: InlineGenerator = {
  def: sunbleachedTarpDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uFade = uniform('fade');
    const uCreases = uniform('creases');
    const uWeave = uniform('weave');
    const vnoise = `${fnName}_vnoise`;
    return /* glsl */ `
// sunbleachedTarp material: desaturated blue + creases + chalk patches + fine weave
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
vec4 ${fnName}(float v, vec2 p) {
  float dens = clamp(v, 0.0, 1.0);
  float fade = clamp(${uFade}, 0.0, 1.0);
  float creaseAmt = clamp(${uCreases}, 0.0, 1.0);
  float weaveAmt = clamp(${uWeave}, 0.0, 1.0);
  // saturated tarp blue washed toward grey by sun
  vec3 fresh = vec3(0.13, 0.33, 0.58);
  vec3 bleached = vec3(0.52, 0.58, 0.6);
  vec3 base = mix(fresh, bleached, fade * 0.85);
  // long folds: a couple of near-straight creases warped by low-freq noise
  float warp = ${vnoise}(p * 1.3) - 0.5;
  float fold1 = sin((p.x * 5.5 + warp * 2.2) * 3.14159265359);
  float fold2 = sin((p.y * 3.5 - warp * 1.6) * 3.14159265359 + 1.1);
  float ridge = max(abs(fold1), abs(fold2));
  // only the folds get strong light/dark; the flat field stays even
  float lit = smoothstep(0.86, 1.0, ridge) * creaseAmt;
  float dark = smoothstep(0.86, 1.0, -min(fold1, fold2)) * creaseAmt;
  vec3 col = base * (1.0 + lit * 0.5 - dark * 0.35);
  // chalky bleached patches
  float chalk = smoothstep(0.62, 0.8, ${vnoise}(p * 4.3 + 21.0)) * fade;
  col = mix(col, vec3(0.86, 0.87, 0.85), chalk * 0.55);
  // very fine orthogonal weave
  float wx = 0.5 + 0.5 * sin(p.x * 150.0);
  float wy = 0.5 + 0.5 * sin(p.y * 150.0);
  float weaveN = (wx * 0.5 + wy * 0.5);
  col *= mix(1.0, 0.86 + 0.28 * weaveN, weaveAmt);
  col *= 0.45 + 0.55 * dens;
  float alpha = clamp(dens * 0.9 + chalk * 0.12 + lit * 0.1, 0.0, 1.0);
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
