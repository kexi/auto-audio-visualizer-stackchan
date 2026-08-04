import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * FBM displacement field. Uses synthRand (not fract(sin)) for hashing.
 * `amount` is applied by the assembler in main(): p += field_N(p) * u_*_amount.
 */
export const noiseDef: GeneratorDefinition = {
  id: 'noise',
  version: 1,
  category: 'field',
  costClass: 'medium',
  impl: 'inline',
  output: 'vector',
  tags: {
    material: ['organic', 'noise'],
    motion: ['turbulent'],
    affect: ['chaotic'],
  },
  parameters: [
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
      default: 0.15,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.8, stateful: false },
};

export const noiseGenerator: InlineGenerator = {
  def: noiseDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uScale = uniform('scale');
    // Helper names unique per operator to avoid collisions when multiple noise ops exist.
    const vnoise = `${fnName}_vnoise`;
    const fbm = `${fnName}_fbm`;
    return /* glsl */ `
// noise field: FBM displacement (synthRand-based value noise)
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
float ${fbm}(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 4; i++) {
    sum += amp * ${vnoise}(p * freq);
    freq *= 2.02;
    amp *= 0.5;
  }
  return sum;
}
// Returns unscaled displacement; assembler multiplies by amount uniform.
vec2 ${fnName}(vec2 p) {
  float s = max(${uScale}, 0.01);
  vec2 q = p * s;
  float nx = ${fbm}(q);
  float ny = ${fbm}(q + vec2(17.3, 9.1));
  return (vec2(nx, ny) - 0.5) * 2.0;
}
`.trim();
  },
};
