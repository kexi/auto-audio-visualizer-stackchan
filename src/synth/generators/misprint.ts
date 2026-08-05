import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Print misregistration — fwidth density edge fringe in CMY-ish offsets.
 * Returns premultiplied alpha.
 */
export const misprintDef: GeneratorDefinition = {
  id: 'misprint',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    material: ['print-misregistration'],
    affect: ['nostalgic'],
  },
  parameters: [
    {
      id: 'hue',
      label: 'Hue',
      kind: 'number',
      min: 0,
      max: 360,
      default: 0,
      modulatable: true,
    },
    {
      id: 'fringe',
      label: 'Fringe',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.45,
      modulatable: true,
    },
    {
      id: 'intensity',
      label: 'Intensity',
      kind: 'number',
      min: 0,
      max: 2,
      default: 1,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.3, stateful: false },
};

export const misprintGenerator: InlineGenerator = {
  def: misprintDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uHue = uniform('hue');
    const uFringe = uniform('fringe');
    const uIntensity = uniform('intensity');
    const hsl2rgb = `${fnName}_hsl2rgb`;
    return /* glsl */ `
// misprint material: base hue + CMY edge fringe from fwidth(v)
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
  float fr = clamp(${uFringe}, 0.0, 1.0);
  float h = mod(${uHue}, 360.0) / 360.0;
  vec3 base = ${hsl2rgb}(h, 0.7, 0.4 + 0.15 * dens);
  // edge magnitude from density gradient
  float edge = abs(fwidth(v));
  float e = smoothstep(0.0, 0.08, edge * 8.0) * fr;
  // CMY-ish fringe offsets
  vec3 cyan = vec3(0.0, 0.85, 0.9);
  vec3 magenta = vec3(0.95, 0.1, 0.65);
  vec3 yellow = vec3(0.95, 0.85, 0.05);
  float phase = dens * 6.28318530718;
  vec3 fringeCol = cyan * (0.5 + 0.5 * sin(phase))
    + magenta * (0.5 + 0.5 * sin(phase + 2.094))
    + yellow * (0.5 + 0.5 * sin(phase + 4.189));
  fringeCol *= 0.55;
  vec3 col = mix(base, base + fringeCol, e);
  col *= intensity;
  float alpha = clamp(dens * intensity, 0.0, 1.0);
  // keep a little fringe visible on soft edges even if dens is mid
  alpha = clamp(alpha + e * dens * 0.25, 0.0, 1.0);
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
