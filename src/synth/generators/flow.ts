import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Directional flow field with synthRand value-noise spatial variation.
 * Angle in degrees. Assembler multiplies return value by amount.
 */
export const flowDef: GeneratorDefinition = {
  id: 'flow',
  version: 1,
  category: 'field',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    material: ['fluid', 'stream'],
    motion: ['directional', 'drift'],
    affect: ['current'],
  },
  parameters: [
    {
      id: 'angle',
      label: 'Angle',
      kind: 'number',
      min: 0,
      max: 360,
      default: 45,
      modulatable: true,
    },
    {
      id: 'speed',
      label: 'Speed',
      kind: 'number',
      min: 0,
      max: 2,
      default: 0.8,
      modulatable: true,
    },
    {
      id: 'scale',
      label: 'Scale',
      kind: 'number',
      min: 0.1,
      max: 8,
      default: 2,
      modulatable: true,
    },
    {
      id: 'amount',
      label: 'Amount',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.2,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.4, stateful: false },
};

export const flowGenerator: InlineGenerator = {
  def: flowDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uAngle = uniform('angle');
    const uSpeed = uniform('speed');
    const uScale = uniform('scale');
    const vnoise = `${fnName}_vnoise`;
    return /* glsl */ `
// flow field: directional displacement with value-noise variation
float ${vnoise}(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  int ix = int(i.x);
  int iy = int(i.y);
  float a = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(ix), uint(iy)));
  float b = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(ix + 1), uint(iy)));
  float c = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(ix), uint(iy + 1)));
  float d = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(ix + 1), uint(iy + 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Returns unscaled displacement; assembler multiplies by amount uniform.
vec2 ${fnName}(vec2 p) {
  float rad = ${uAngle} * 0.017453292519943295;
  vec2 dir = vec2(cos(rad), sin(rad));
  float sc = max(${uScale}, 0.1);
  float n = ${vnoise}(p * sc);
  float mag = max(${uSpeed}, 0.0) * (0.35 + 0.65 * n);
  return dir * mag;
}
`.trim();
  },
};
