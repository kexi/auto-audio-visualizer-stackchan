import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Cold green-white fluorescent material with slight flicker.
 * Returns premultiplied alpha.
 */
export const fluorescentDef: GeneratorDefinition = {
  id: 'fluorescent',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    material: ['fluorescent'],
    motion: ['flicker'],
    environment: ['interior'],
    affect: ['nostalgic'],
  },
  parameters: [
    {
      id: 'hue',
      label: 'Hue',
      kind: 'number',
      min: 0,
      max: 360,
      default: 95,
      modulatable: true,
    },
    {
      id: 'flicker',
      label: 'Flicker',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.35,
      modulatable: true,
    },
    {
      id: 'intensity',
      label: 'Intensity',
      kind: 'number',
      min: 0,
      max: 2,
      default: 1.1,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.25, stateful: false },
};

export const fluorescentGenerator: InlineGenerator = {
  def: fluorescentDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uHue = uniform('hue');
    const uFlicker = uniform('flicker');
    const uIntensity = uniform('intensity');
    const hsl2rgb = `${fnName}_hsl2rgb`;
    return /* glsl */ `
// fluorescent material: cold green-white tube light + flicker, premultiplied alpha
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
  float flickAmt = clamp(${uFlicker}, 0.0, 1.0);
  uint tick = uint(floor(uTime * 12.0));
  float rFlick = synthRand(${seedUniform}, ${nsUniform}, tick);
  float sinFlick = 0.5 + 0.5 * sin(uTime * 37.0);
  float flickMix = mix(rFlick, sinFlick, 0.45);
  float live = 1.0 - flickAmt * step(0.72, flickMix) * 0.85;
  live *= mix(1.0, 0.88 + 0.12 * sinFlick, flickAmt);
  float alpha = pow(dens, 1.1) * intensity * live;
  alpha = clamp(alpha, 0.0, 1.0);
  float h = mod(${uHue}, 360.0) / 360.0;
  // cold low-sat fluorescent body
  float core = smoothstep(0.3, 0.9, dens);
  vec3 col = ${hsl2rgb}(h, 0.28 + 0.12 * core, 0.55 + 0.2 * core);
  col += vec3(0.08, 0.1, 0.06) * core * intensity;
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
