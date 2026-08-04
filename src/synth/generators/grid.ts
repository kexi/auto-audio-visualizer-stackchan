import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Lattice / grid source — density peaks on cell boundaries.
 * cells: subdivision count, thickness: line half-width as fraction of cell.
 */
export const gridDef: GeneratorDefinition = {
  id: 'grid',
  version: 1,
  category: 'source',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['geometric', 'lattice'],
    environment: ['architectural'],
    affect: ['structured'],
  },
  parameters: [
    {
      id: 'cells',
      label: 'Cells',
      kind: 'int',
      min: 2,
      max: 64,
      default: 8,
      modulatable: true,
    },
    {
      id: 'thickness',
      label: 'Thickness',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.08,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.3, stateful: false },
};

export const gridGenerator: InlineGenerator = {
  def: gridDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uCells = uniform('cells');
    const uThickness = uniform('thickness');
    return /* glsl */ `
// grid source: lattice density 0..1 on cell edges
float ${fnName}(vec2 p) {
  float cells = max(float(${uCells}), 1.0);
  float thickness = clamp(${uThickness}, 0.0, 1.0);
  vec2 fp = fract(p * cells);
  vec2 d = min(fp, 1.0 - fp);
  float md = min(d.x, d.y);
  float halfW = max(thickness * 0.5, 1e-4);
  // Resolution-independent AA: keep stroke ≥ ~0.75px and soft-edge over ~1px.
  float px = fwidth(md);
  float w = max(halfW, px * 0.75);
  return 1.0 - smoothstep(w - px, w + px, md);
}
`.trim();
  },
};
