import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Sumi / ink-bleed material — soft blotchy dark density with hue tint.
 * Returns premultiplied alpha.
 */
export const inkDef: GeneratorDefinition = {
  id: 'ink',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    material: ['ink', 'sumi', 'wash'],
    culturalTexture: ['calligraphic', 'east-asian'],
    affect: ['meditative', 'organic'],
  },
  parameters: [
    {
      id: 'hue',
      label: 'Hue',
      kind: 'number',
      min: 0,
      max: 360,
      default: 220,
      modulatable: true,
    },
    {
      id: 'density',
      label: 'Density',
      kind: 'number',
      min: 0,
      max: 2,
      default: 1,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.25, stateful: false },
};

export const inkGenerator: InlineGenerator = {
  def: inkDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uHue = uniform('hue');
    const uDensity = uniform('density');
    const hsl2rgb = `${fnName}_hsl2rgb`;
    return /* glsl */ `
// ink material: soft blotchy dark wash, premultiplied alpha
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
  float densIn = clamp(v, 0.0, 1.0);
  float dens = max(${uDensity}, 0.0);
  // soft blot: expand mid-tones, dark core
  float blot = smoothstep(0.05, 0.85, densIn);
  float core = pow(densIn, 0.65);
  float alpha = clamp(mix(blot, core, 0.55) * dens, 0.0, 1.0);
  float h = mod(${uHue}, 360.0) / 360.0;
  // dark ink body with slight hue tint (low lightness, moderate sat)
  float sat = 0.35 + 0.25 * densIn;
  float lit = 0.08 + 0.18 * (1.0 - core);
  vec3 col = ${hsl2rgb}(h, sat, lit);
  // slight edge bloom (wet bleed)
  col += col * (1.0 - densIn) * 0.15;
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
