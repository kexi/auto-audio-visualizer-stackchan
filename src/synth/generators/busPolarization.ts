import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Bus window polarization — thin-film purple→green→blue by view angle; bands slowly cross.
 * Returns premultiplied alpha.
 */
export const busPolarizationDef: GeneratorDefinition = {
  id: 'busPolarization',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    environment: ['transit'],
    affect: ['iridescent', 'wistful'],
  },
  parameters: [
    {
      id: 'bands',
      label: 'Bands',
      kind: 'number',
      min: 0.5,
      max: 4,
      default: 1.8,
      modulatable: true,
    },
    {
      id: 'drift',
      label: 'Drift',
      kind: 'number',
      min: 0,
      max: 2,
      default: 0.6,
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
  cost: { passes: 0, relativeFill: 0.3, stateful: false },
};

export const busPolarizationGenerator: InlineGenerator = {
  def: busPolarizationDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uBands = uniform('bands');
    const uDrift = uniform('drift');
    const uIntensity = uniform('intensity');
    const hsl2rgb = `${fnName}_hsl2rgb`;
    return /* glsl */ `
// busPolarization material: thin-film purple→green→blue bands by view angle
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
  float b = clamp(${uBands}, 0.5, 4.0);
  float dr = max(${uDrift}, 0.0);
  float intensity = max(${uIntensity}, 0.0);
  // "view angle" from position + slow crossing bands
  float view = p.x * 0.55 + p.y * 0.25 + uTime * dr * 0.12;
  float bandPhase = view * b + sin(uTime * 0.08 * dr + p.y * 1.5) * 0.3;
  float t = fract(bandPhase);
  // purple → green → blue thin-film cycle
  float h;
  if (t < 0.33) h = mix(0.78, 0.33, t / 0.33); // purple to green
  else if (t < 0.66) h = mix(0.33, 0.58, (t - 0.33) / 0.33); // green to blue
  else h = mix(0.58, 0.78, (t - 0.66) / 0.34); // blue to purple
  float sat = 0.45 + 0.35 * dens;
  float lit = 0.18 + 0.45 * dens + 0.12 * sin(bandPhase * 6.28318530718);
  vec3 col = ${hsl2rgb}(h, sat, lit);
  // soft polarization highlight
  float pol = 0.5 + 0.5 * sin(bandPhase * 6.28318530718);
  col += vec3(0.15, 0.12, 0.2) * pol * dens * 0.4;
  float alpha = clamp(pow(dens, 1.1) * intensity * (0.7 + 0.3 * pol), 0.0, 1.0);
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
