import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * CD underside diffraction — thin rainbow along density edges; virtual light runs spectrum.
 * Returns premultiplied alpha.
 */
export const cdDiffractionDef: GeneratorDefinition = {
  id: 'cdDiffraction',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    material: ['compact-disc'],
    affect: ['shiny', '2000s', 'synthetic'],
  },
  parameters: [
    {
      id: 'spectrum',
      label: 'Spectrum',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.65,
      modulatable: true,
    },
    {
      id: 'lightSpeed',
      label: 'Light Speed',
      kind: 'number',
      min: 0,
      max: 3,
      default: 1.0,
      modulatable: true,
    },
    {
      id: 'intensity',
      label: 'Intensity',
      kind: 'number',
      min: 0,
      max: 2,
      default: 1.15,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.35, stateful: false },
};

export const cdDiffractionGenerator: InlineGenerator = {
  def: cdDiffractionDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uSpectrum = uniform('spectrum');
    const uLightSpeed = uniform('lightSpeed');
    const uIntensity = uniform('intensity');
    const hsl2rgb = `${fnName}_hsl2rgb`;
    return /* glsl */ `
// cdDiffraction material: rainbow along fwidth edges, running virtual light
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
  float specAmt = clamp(${uSpectrum}, 0.0, 1.0);
  float spd = max(${uLightSpeed}, 0.0);
  float intensity = max(${uIntensity}, 0.0);
  // dark polycarbonate base
  vec3 base = vec3(0.06, 0.07, 0.09) + dens * 0.12;
  // edge diffraction from fwidth(v)
  float edge = abs(fwidth(v));
  float e = smoothstep(0.0, 0.06, edge * 10.0);
  // virtual light angle runs so spectrum travels
  float light = p.x * 0.8 + p.y * 0.35 + uTime * spd * 0.35;
  float hue = fract(light * 0.55 + dens * 0.4);
  vec3 rain = ${hsl2rgb}(hue, 0.85, 0.45 + 0.15 * dens);
  // thin spectral split (slight RGB phase offsets)
  float h2 = fract(hue + 0.08);
  float h3 = fract(hue - 0.08);
  vec3 rain2 = ${hsl2rgb}(h2, 0.8, 0.4);
  vec3 rain3 = ${hsl2rgb}(h3, 0.8, 0.4);
  vec3 split = rain * vec3(1.0, 0.35, 0.35) + rain2 * vec3(0.35, 1.0, 0.35) + rain3 * vec3(0.35, 0.35, 1.0);
  split *= 0.55;
  vec3 col = mix(base, base + mix(rain, split, 0.55) * specAmt, e * specAmt);
  // soft body iridescence even off hard edges
  float soft = dens * (0.5 + 0.5 * sin(light * 6.28318530718));
  col += rain * soft * specAmt * 0.18;
  col *= intensity;
  float alpha = clamp((dens * 0.75 + e * dens * 0.5) * intensity, 0.0, 1.0);
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
