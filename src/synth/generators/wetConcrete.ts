import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Dark low-sat wet concrete with cellular speckles and sheen on high density.
 * Returns premultiplied alpha.
 */
export const wetConcreteDef: GeneratorDefinition = {
  id: 'wetConcrete',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    material: ['wet-concrete'],
    affect: ['humid', 'eerie'],
  },
  parameters: [
    {
      id: 'hue',
      label: 'Hue',
      kind: 'number',
      min: 0,
      max: 360,
      default: 210,
      modulatable: true,
    },
    {
      id: 'speckle',
      label: 'Speckle',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.4,
      modulatable: true,
    },
    {
      id: 'sheen',
      label: 'Sheen',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.35,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.35, stateful: false },
};

export const wetConcreteGenerator: InlineGenerator = {
  def: wetConcreteDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uHue = uniform('hue');
    const uSpeckle = uniform('speckle');
    const uSheen = uniform('sheen');
    const hsl2rgb = `${fnName}_hsl2rgb`;
    return /* glsl */ `
// wetConcrete material: dark low-sat body + speckles + density sheen
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
  float spAmt = clamp(${uSpeckle}, 0.0, 1.0);
  float shAmt = clamp(${uSheen}, 0.0, 1.0);
  // cellular speckles
  float pitch = 28.0;
  vec2 cell = floor(p * pitch + 0.5);
  int ix = int(cell.x);
  int iy = int(cell.y);
  uint hcell = synthHashCombine(uint(ix), uint(iy));
  float rSp = synthRand(${seedUniform}, ${nsUniform}, hcell);
  float grain = mix(1.0, 0.55 + 0.9 * rSp, spAmt);
  float h = mod(${uHue}, 360.0) / 360.0;
  // dark damp body, low saturation
  float lit = 0.06 + 0.14 * dens * grain;
  float sat = 0.12 + 0.08 * dens;
  vec3 col = ${hsl2rgb}(h, sat, lit);
  // sheen boost on high density
  float sheen = smoothstep(0.45, 0.95, dens) * shAmt;
  col += vec3(0.18, 0.2, 0.22) * sheen;
  float alpha = clamp(dens * (0.75 + 0.25 * grain), 0.0, 1.0);
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
