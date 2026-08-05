import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Nicotine-stained ceiling — ivory→tea-yellow stains, grey edges, grain + wipe noise.
 * Returns premultiplied alpha.
 */
export const nicotineCeilingDef: GeneratorDefinition = {
  id: 'nicotineCeiling',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    environment: ['club'],
    affect: ['aged', 'murky'],
  },
  parameters: [
    {
      id: 'stain',
      label: 'Stain',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'grain',
      label: 'Grain',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.4,
      modulatable: true,
    },
    {
      id: 'intensity',
      label: 'Intensity',
      kind: 'number',
      min: 0,
      max: 2,
      default: 1.0,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.3, stateful: false },
};

export const nicotineCeilingGenerator: InlineGenerator = {
  def: nicotineCeilingDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uStain = uniform('stain');
    const uGrain = uniform('grain');
    const uIntensity = uniform('intensity');
    return /* glsl */ `
// nicotineCeiling material: ivory→tea-yellow stains, grey edges, grain + wipe noise
vec4 ${fnName}(float v, vec2 p) {
  float dens = clamp(v, 0.0, 1.0);
  float stainAmt = clamp(${uStain}, 0.0, 1.0);
  float grainAmt = clamp(${uGrain}, 0.0, 1.0);
  float intensity = max(${uIntensity}, 0.0);
  // low-freq stain field
  vec2 sc0 = floor(p * 2.5);
  vec2 sc1 = floor(p * 5.5 + 3.1);
  uint h0 = synthHashCombine(uint(int(sc0.x)), uint(int(sc0.y)));
  uint h1 = synthHashCombine(uint(int(sc1.x)), uint(int(sc1.y)));
  float s0 = synthRand(${seedUniform}, ${nsUniform}, h0);
  float s1 = synthRand(${seedUniform}, ${nsUniform}, h1);
  // soft bilinear-ish via fract
  vec2 f0 = fract(p * 2.5);
  f0 = f0 * f0 * (3.0 - 2.0 * f0);
  float stain = mix(s0, s1, 0.45) * (0.7 + 0.3 * f0.x);
  // ivory → tea-yellow
  vec3 ivory = vec3(0.9, 0.88, 0.8);
  vec3 tea = vec3(0.72, 0.55, 0.28);
  vec3 col = mix(ivory, tea, stain * stainAmt);
  // edges greyish (water/age ring near frame)
  float edge = smoothstep(0.45, 1.1, length(p));
  col = mix(col, vec3(0.45, 0.44, 0.42), edge * 0.55 * stainAmt);
  // fine grain
  vec2 gcell = floor(p * 90.0);
  uint gh = synthHashCombine(uint(int(gcell.x)), uint(int(gcell.y)));
  float gn = synthRand(${seedUniform}, ${nsUniform}, gh);
  col *= 1.0 + (gn - 0.5) * grainAmt * 0.18;
  // wipe-direction noise (diagonal cleaning strokes)
  float wipe = sin(p.x * 28.0 + p.y * 14.0) * 0.5 + 0.5;
  vec2 wcell = floor(vec2(p.x + p.y, p.x - p.y) * 20.0);
  uint wh = synthHashCombine(uint(int(wcell.x)), uint(int(wcell.y)));
  float wr = synthRand(${seedUniform}, ${nsUniform}, wh);
  col = mix(col, col * (0.9 + 0.15 * wr), wipe * grainAmt * 0.35);
  col *= intensity * (0.5 + 0.55 * dens);
  float alpha = clamp(dens * intensity * (0.8 + 0.2 * stain), 0.0, 1.0);
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
