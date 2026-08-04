import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Neon glow material — density → premultiplied-alpha glow color.
 */
export const neonDef: GeneratorDefinition = {
  id: 'neon',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    material: ['neon', 'emissive'],
    culturalTexture: ['cyber'],
    affect: ['electric'],
  },
  parameters: [
    {
      id: 'hue',
      label: 'Hue',
      kind: 'number',
      min: 0,
      max: 360,
      default: 200,
      modulatable: true,
    },
    {
      id: 'intensity',
      label: 'Intensity',
      kind: 'number',
      min: 0,
      max: 2,
      default: 1.2,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.2, stateful: false },
};

export const neonGenerator: InlineGenerator = {
  def: neonDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uHue = uniform('hue');
    const uIntensity = uniform('intensity');
    const hsl2rgb = `${fnName}_hsl2rgb`;
    return /* glsl */ `
// neon material: density → premultiplied alpha glow
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
  float intensity = max(${uIntensity}, 0.0);
  float alpha = pow(dens, 1.25) * intensity;
  alpha = clamp(alpha, 0.0, 1.0);
  float h = mod(${uHue}, 360.0) / 360.0;
  float core = smoothstep(0.35, 0.95, dens);
  vec3 col = ${hsl2rgb}(h, 0.9, 0.45 + 0.25 * core);
  col += col * core * 0.55 * intensity;
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
