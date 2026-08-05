import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Risograph two-colour print — density split into two ink plates with a slight
 * registration offset (approximated from dFdx/dFdy of the density), paper white kept.
 * Returns premultiplied alpha.
 */
export const risoDef: GeneratorDefinition = {
  id: 'riso',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    material: ['risograph'],
    affect: ['zine', 'playful'],
  },
  parameters: [
    {
      id: 'inkA',
      label: 'Ink A Hue',
      kind: 'number',
      min: 0,
      max: 360,
      default: 330,
      modulatable: true,
    },
    {
      id: 'inkB',
      label: 'Ink B Hue',
      kind: 'number',
      min: 0,
      max: 360,
      default: 205,
      modulatable: true,
    },
    {
      id: 'misalign',
      label: 'Misalign',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.35,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.35, stateful: false },
};

export const risoGenerator: InlineGenerator = {
  def: risoDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uInkA = uniform('inkA');
    const uInkB = uniform('inkB');
    const uMisalign = uniform('misalign');
    const hsl2rgb = `${fnName}_hsl2rgb`;
    return /* glsl */ `
// riso material: two ink plates over paper; plate offset approximated by density derivatives
vec3 ${hsl2rgb}(float h, float s, float l) {
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float hp = mod(h, 1.0) * 6.0;
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  vec3 rgb;
  if (hp < 1.0) rgb = vec3(c, x, 0.0);
  else if (hp < 2.0) rgb = vec3(x, c, 0.0);
  else if (hp < 3.0) rgb = vec3(0.0, c, x);
  else if (hp < 4.0) rgb = vec3(0.0, x, c);
  else if (hp < 5.0) rgb = vec3(x, 0.0, c);
  else rgb = vec3(c, 0.0, x);
  float m = l - 0.5 * c;
  return rgb + m;
}
vec4 ${fnName}(float v, vec2 p) {
  float dens = clamp(v, 0.0, 1.0);
  float mis = clamp(${uMisalign}, 0.0, 1.0);
  float hA = mod(${uInkA}, 360.0) / 360.0;
  float hB = mod(${uInkB}, 360.0) / 360.0;
  // first-order shift of the density field stands in for a mis-registered plate
  float off = mis * 3.5;
  float vA = clamp(v + dFdx(v) * off, 0.0, 1.0);
  float vB = clamp(v - dFdy(v) * off - dFdx(v) * off * 0.4, 0.0, 1.0);
  // ink coverage: A carries the body, B only the darker part
  float cA = smoothstep(0.08, 0.85, vA);
  float cB = smoothstep(0.38, 1.0, vB);
  // riso ink lays down unevenly
  vec2 gc = floor(p * 260.0);
  uint gh = synthHashCombine(uint(int(gc.x)), uint(int(gc.y)));
  float mottle = 0.86 + 0.28 * synthRand(${seedUniform}, ${nsUniform}, gh);
  cA *= mottle;
  cB *= mottle;
  vec3 inkA = ${hsl2rgb}(hA, 0.95, 0.58);
  vec3 inkB = ${hsl2rgb}(hB, 0.85, 0.45);
  vec3 paper = vec3(0.94, 0.93, 0.9);
  // inks multiply over the sheet
  vec3 col = paper;
  col = mix(col, col * inkA * 1.2, clamp(cA, 0.0, 1.0));
  col = mix(col, col * inkB, clamp(cB, 0.0, 1.0));
  float alpha = clamp(max(cA, cB) * 0.95 + dens * 0.12, 0.0, 1.0);
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
