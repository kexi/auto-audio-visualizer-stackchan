import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Barcode — uneven vertical bars whose widths come from synthRand, with dropped bars.
 */
export const barcodeDef: GeneratorDefinition = {
  id: 'barcode',
  version: 1,
  category: 'source',
  costClass: 'micro',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['print'],
    affect: ['graphic', 'mundane'],
  },
  parameters: [
    {
      id: 'bars',
      label: 'Bars',
      kind: 'number',
      min: 16,
      max: 128,
      default: 34,
      modulatable: true,
    },
    {
      id: 'density',
      label: 'Density',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.25, stateful: false },
};

export const barcodeGenerator: InlineGenerator = {
  def: barcodeDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uBars = uniform('bars');
    const uDensity = uniform('density');
    return /* glsl */ `
// barcode source: per-slot random bar widths, occasional missing bar
float ${fnName}(vec2 p) {
  float bars = clamp(${uBars}, 16.0, 128.0);
  float dens = clamp(${uDensity}, 0.0, 1.0);
  float g = (p.x + 0.5) * bars;
  float idx = floor(g);
  uint bi = uint(int(idx));
  float r = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(bi, 5u));
  // ink width within the slot
  float halfW = clamp(dens * mix(0.12, 0.46, r), 0.01, 0.48);
  // quiet gaps: a few slots print nothing
  float gap = step(synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(bi, 6u)), 0.08);
  float d = abs(fract(g) - 0.5);
  float px = clamp(fwidth(g), 1e-5, 0.5);
  float w = max(halfW, px * 0.75);
  float bar = 1.0 - smoothstep(w - px, w + px, d);
  // thermal-print falloff toward the top edge
  float wash = 1.0 - 0.35 * smoothstep(0.1, 0.5, p.y);
  return clamp(bar * (1.0 - gap) * wash, 0.0, 1.0);
}
`.trim();
  },
};
