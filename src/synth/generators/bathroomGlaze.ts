import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Taiwan bathroom glaze — pale teal/milky/pink tints, hard specular, fine bump, water-scum haze.
 * Returns premultiplied alpha.
 */
export const bathroomGlazeDef: GeneratorDefinition = {
  id: 'bathroomGlaze',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    culturalTexture: ['taiwan-streetscape'],
    environment: ['domestic'],
    affect: ['retro', 'humid'],
  },
  parameters: [
    {
      id: 'tint',
      label: 'Tint',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.45,
      modulatable: true,
    },
    {
      id: 'gloss',
      label: 'Gloss',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'scum',
      label: 'Scum',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.35,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.35, stateful: false },
};

export const bathroomGlazeGenerator: InlineGenerator = {
  def: bathroomGlazeDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uTint = uniform('tint');
    const uGloss = uniform('gloss');
    const uScum = uniform('scum');
    return /* glsl */ `
// bathroomGlaze material: pale teal/pink glaze + hard specular + water-scum haze
vec4 ${fnName}(float v, vec2 p) {
  float dens = clamp(v, 0.0, 1.0);
  float tint = clamp(${uTint}, 0.0, 1.0);
  float gloss = clamp(${uGloss}, 0.0, 1.0);
  float scumAmt = clamp(${uScum}, 0.0, 1.0);
  // pale teal / milky / light pink by tint
  vec3 teal = vec3(0.55, 0.78, 0.76);
  vec3 milky = vec3(0.88, 0.86, 0.84);
  vec3 pink = vec3(0.9, 0.72, 0.76);
  vec3 body = mix(milky, mix(teal, pink, smoothstep(0.35, 0.85, tint)), 0.55 + 0.35 * dens);
  body = mix(body, milky, 0.25 * (1.0 - tint));
  // fine bump via cell noise
  vec2 bcell = floor(p * 64.0);
  uint bh = synthHashCombine(uint(int(bcell.x)), uint(int(bcell.y)));
  float bump = synthRand(${seedUniform}, ${nsUniform}, bh);
  body *= 0.92 + 0.12 * bump;
  // hard specular highlight that drifts slowly
  vec2 specC = vec2(sin(uTime * 0.11) * 0.45, cos(uTime * 0.09) * 0.35);
  float sd = length(p - specC);
  float spec = pow(max(1.0 - sd * mix(1.2, 2.8, 1.0 - gloss), 0.0), mix(8.0, 40.0, gloss));
  body += vec3(1.0) * spec * gloss * 0.75;
  // white water-scum haze
  vec2 scell = floor(p * 10.0);
  uint sh = synthHashCombine(uint(int(scell.x)), uint(int(scell.y)));
  float scumR = synthRand(${seedUniform}, ${nsUniform}, sh);
  float scumMask = smoothstep(0.55, 0.95, scumR) * scumAmt;
  // streaky scum
  float streak = 0.5 + 0.5 * sin(p.x * 22.0 + scumR * 6.0);
  scumMask *= streak;
  body = mix(body, vec3(0.92, 0.93, 0.9), scumMask * 0.55);
  body *= 0.55 + 0.55 * dens;
  float alpha = clamp(dens * (0.8 + 0.2 * gloss) + scumMask * 0.12, 0.0, 1.0);
  return vec4(body * alpha, alpha);
}
`.trim();
  },
};
