import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Hexagonal lattice (亀甲) — honeycomb cell borders, fwidth-AA thin lines.
 */
export const hexGridDef: GeneratorDefinition = {
  id: 'hexGrid',
  version: 1,
  category: 'source',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    culturalTexture: ['japan'],
    affect: ['graphic', 'traditional'],
  },
  parameters: [
    {
      id: 'scale',
      label: 'Scale',
      kind: 'number',
      min: 2,
      max: 24,
      default: 8,
      modulatable: true,
    },
    {
      id: 'thickness',
      label: 'Thickness',
      kind: 'number',
      min: 0.004,
      max: 0.08,
      default: 0.018,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.35, stateful: false },
};

export const hexGridGenerator: InlineGenerator = {
  def: hexGridDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uScale = uniform('scale');
    const uThickness = uniform('thickness');
    const hexDist = `${fnName}_hexDist`;
    return /* glsl */ `
// hexGrid source: honeycomb (亀甲) borders — nearest-of-two-lattices, fwidth AA
float ${hexDist}(vec2 q) {
  q = abs(q);
  // hex border sits at 0.5 for spacing vec2(1.0, sqrt(3))
  return max(dot(q, normalize(vec2(1.0, 1.73205080757))), q.x);
}
float ${fnName}(vec2 p) {
  float sc = clamp(${uScale}, 2.0, 24.0);
  float th = clamp(${uThickness}, 0.004, 0.08);
  vec2 gp = p * sc;
  vec2 r = vec2(1.0, 1.73205080757);
  // two interleaved rectangular lattices; nearest one is the hex center
  vec2 hA = mod(gp, r) - r * 0.5;
  vec2 hB = mod(gp - r * 0.5, r) - r * 0.5;
  vec2 gv = dot(hA, hA) < dot(hB, hB) ? hA : hB;
  float d = abs(0.5 - ${hexDist}(gv));
  float halfW = max(th * sc * 0.5, 1e-4);
  float px = fwidth(d);
  float w = max(halfW, px * 0.75);
  return 1.0 - smoothstep(w - px, w + px, d);
}
`.trim();
  },
};
