import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Voronoi / Worley cell field — F1 interior vs (F2−F1) edge mix via `edge` param.
 * Feature points from synthRand in a 3×3 cell neighborhood.
 */
export const cellsDef: GeneratorDefinition = {
  id: 'cells',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['cellular', 'mosaic'],
    environment: ['crystalline'],
    affect: ['organic', 'tessellated'],
  },
  parameters: [
    {
      id: 'scale',
      label: 'Scale',
      kind: 'number',
      min: 1,
      max: 32,
      default: 6,
      modulatable: true,
    },
    {
      id: 'edge',
      label: 'Edge',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.5,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.75, stateful: false },
};

export const cellsGenerator: InlineGenerator = {
  def: cellsDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uScale = uniform('scale');
    const uEdge = uniform('edge');
    return /* glsl */ `
// cells source: Voronoi F1 / edge (F2-F1) mix
float ${fnName}(vec2 p) {
  float sc = max(${uScale}, 1.0);
  float edgeAmt = clamp(${uEdge}, 0.0, 1.0);
  vec2 gp = p * sc;
  vec2 cell = floor(gp);
  float f1 = 1e9;
  float f2 = 1e9;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      int ix = int(c.x);
      int iy = int(c.y);
      uint h = synthHashCombine(uint(ix), uint(iy));
      float rx = synthRand(${seedUniform}, ${nsUniform}, h);
      float ry = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(h, 1u));
      vec2 pt = c + vec2(rx, ry);
      float dist = length(gp - pt);
      if (dist < f1) {
        f2 = f1;
        f1 = dist;
      } else if (dist < f2) {
        f2 = dist;
      }
    }
  }
  // edge=0: cell interior (1-F1); edge=1: boundaries where F2≈F1
  float interior = 1.0 - clamp(f1 * 1.75, 0.0, 1.0);
  float boundary = 1.0 - smoothstep(0.0, 0.12, f2 - f1);
  return mix(interior, boundary, edgeAmt);
}
`.trim();
  },
};
