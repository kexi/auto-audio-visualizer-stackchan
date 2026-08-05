import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Sea-salt bloom — white crystal fields on a dark wet ground: opaque cores,
 * powdery rims, slow growth and occasional patches vanishing on a timeBucket.
 * Returns premultiplied alpha.
 */
export const seaSaltDef: GeneratorDefinition = {
  id: 'seaSalt',
  version: 1,
  category: 'material',
  costClass: 'medium',
  impl: 'inline',
  output: 'color',
  tags: {
    material: ['salt-crust'],
    environment: ['coastal'],
    affect: ['weathered', 'quiet'],
  },
  parameters: [
    {
      id: 'growth',
      label: 'Growth',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'crust',
      label: 'Crust',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.5,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.6, stateful: false },
};

export const seaSaltGenerator: InlineGenerator = {
  def: seaSaltDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uGrowth = uniform('growth');
    const uCrust = uniform('crust');
    const vnoise = `${fnName}_vnoise`;
    return /* glsl */ `
// seaSalt material: multi-octave synthRand cells thresholded into salt crust
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
  float growth = clamp(${uGrowth}, 0.0, 1.0);
  float crustAmt = clamp(${uCrust}, 0.0, 1.0);
  // branchy crystal field
  float n = 0.0;
  float amp = 0.5;
  float freq = 3.0;
  for (int i = 0; i < 4; i++) {
    n += amp * ${vnoise}(p * freq + float(i) * 9.1);
    freq *= 2.07;
    amp *= 0.5;
  }
  n /= 0.9375;
  // crystals creep outward over a slow bucket
  uint timeBucket = uint(floor(uTime * 0.15));
  float creep = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(timeBucket, 9u));
  float thr = mix(0.68, 0.4, growth) - 0.05 * creep;
  // opaque core, powdery rim
  float core = smoothstep(thr, thr + 0.05, n);
  float powder = smoothstep(thr - 0.14, thr, n) * 0.6;
  // some patches drop out entirely on a bucket
  vec2 rc = floor(p * 3.0);
  uint rh = synthHashCombine(uint(int(rc.x)), uint(int(rc.y)));
  float shed = step(0.9, synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(rh, timeBucket)));
  float salt = clamp((core + powder * 0.5) * (1.0 - shed * 0.85), 0.0, 1.0);
  salt *= mix(0.45, 1.0, crustAmt);
  // wet dark ground under the crust
  vec3 ground = vec3(0.05, 0.065, 0.075) + dens * 0.14;
  vec3 white = vec3(0.9, 0.93, 0.95);
  vec3 col = mix(ground, white, salt * (0.35 + 0.65 * dens));
  // dry sparkle on the coarse crust
  vec2 sc = floor(p * 190.0);
  uint sh = synthHashCombine(uint(int(sc.x)), uint(int(sc.y)));
  float spark = step(0.985, synthRand(${seedUniform}, ${nsUniform}, sh)) * crustAmt;
  col += spark * salt * 0.35;
  float alpha = clamp(dens * (0.7 + 0.3 * salt) + salt * crustAmt * 0.3, 0.0, 1.0);
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
