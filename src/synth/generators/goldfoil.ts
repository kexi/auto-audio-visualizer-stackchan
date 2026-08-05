import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Gold leaf (金箔) — lit density becomes an angle-dependent specular gold with
 * synthRand foil unevenness; unlit density stays lacquer black.
 * Returns premultiplied alpha.
 */
export const goldfoilDef: GeneratorDefinition = {
  id: 'goldfoil',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    material: ['gold-leaf'],
    culturalTexture: ['east-asia'],
    affect: ['ornate', 'festive'],
  },
  parameters: [
    {
      id: 'sparkle',
      label: 'Sparkle',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.5,
      modulatable: true,
    },
    {
      id: 'patina',
      label: 'Patina',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.3,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.4, stateful: false },
};

export const goldfoilGenerator: InlineGenerator = {
  def: goldfoilDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uSparkle = uniform('sparkle');
    const uPatina = uniform('patina');
    return /* glsl */ `
// goldfoil material: per-facet specular gold over lacquer black, synthRand foil grain
vec4 ${fnName}(float v, vec2 p) {
  float dens = clamp(v, 0.0, 1.0);
  float sparkle = clamp(${uSparkle}, 0.0, 1.0);
  float patinaAmt = clamp(${uPatina}, 0.0, 1.0);
  // leaf facets — each one catches the light at its own angle
  vec2 fc = floor(p * 22.0);
  uint fh = synthHashCombine(uint(int(fc.x)), uint(int(fc.y)));
  float facet = synthRand(${seedUniform}, ${nsUniform}, fh);
  float a = facet * 6.28318530718;
  vec2 dir = vec2(cos(a), sin(a));
  // a virtual light sweeps across the sheet
  float along = dot(p, dir) * 26.0 + uTime * 0.9 * (0.3 + sparkle);
  float glint = pow(max(sin(along), 0.0), 8.0) * sparkle;
  // hairline foil grain within the facet
  float grain = 0.85 + 0.3 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(fh, 4u));
  vec3 deepGold = vec3(0.55, 0.4, 0.11);
  vec3 brightGold = vec3(1.0, 0.86, 0.5);
  vec3 gold = mix(deepGold, brightGold, clamp(dens * 0.6 + glint, 0.0, 1.0)) * grain;
  // tarnish patches pull toward dark green-brown
  vec2 pc = floor(p * 5.0);
  uint ph = synthHashCombine(uint(int(pc.x)), uint(int(pc.y)));
  float tarnish = smoothstep(0.55, 0.95, synthRand(${seedUniform}, ${nsUniform}, ph)) * patinaAmt;
  gold = mix(gold, vec3(0.2, 0.19, 0.11), tarnish * 0.7);
  // seams between leaves stay black
  vec2 sf = abs(fract(p * 22.0) - 0.5);
  float seam = smoothstep(0.44, 0.5, max(sf.x, sf.y));
  vec3 lacquer = vec3(0.02, 0.018, 0.015);
  vec3 col = mix(lacquer, gold, dens * (1.0 - seam * 0.55));
  float alpha = clamp(dens * (0.85 + 0.15 * glint) + glint * dens * 0.3, 0.0, 1.0);
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
