import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Hash-based point / stipple field — one feature point per cell via synthRand.
 * Not a particle simulation; density peaks near hashed cell centers with distance falloff.
 */
export const pointsDef: GeneratorDefinition = {
  id: 'points',
  version: 1,
  category: 'source',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['stipple', 'dot'],
    motion: ['static'],
    affect: ['sparse', 'tactile'],
  },
  parameters: [
    {
      id: 'density',
      label: 'Density',
      kind: 'number',
      min: 1,
      max: 64,
      default: 12,
      modulatable: true,
    },
    {
      id: 'size',
      label: 'Size',
      kind: 'number',
      min: 0.01,
      max: 1,
      default: 0.15,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.45, stateful: false },
};

export const pointsGenerator: InlineGenerator = {
  def: pointsDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uDensity = uniform('density');
    const uSize = uniform('size');
    return /* glsl */ `
// points source: hash-based stipple field (3x3 cell neighborhood)
float ${fnName}(vec2 p) {
  float dens = max(${uDensity}, 1.0);
  float sz = max(${uSize}, 0.01);
  vec2 gp = p * dens;
  vec2 cell = floor(gp);
  float best = 1e9;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      int ix = int(c.x);
      int iy = int(c.y);
      uint h = synthHashCombine(uint(ix), uint(iy));
      float rx = synthRand(${seedUniform}, ${nsUniform}, h);
      float ry = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(h, 1u));
      vec2 pt = c + vec2(rx, ry);
      best = min(best, length(gp - pt));
    }
  }
  float r = max(sz, 1e-4);
  return 1.0 - smoothstep(0.0, r, best);
}
`.trim();
  },
};
