import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Iso-contour bandpass — keep only a band around a density level.
 */
export const outlineDef: GeneratorDefinition = {
  id: 'outline',
  version: 1,
  category: 'modifier',
  costClass: 'micro',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['hard-edge', 'print'],
    affect: ['graphic'],
  },
  parameters: [
    {
      id: 'level',
      label: 'Level',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.5,
      modulatable: true,
    },
    {
      id: 'width',
      label: 'Width',
      kind: 'number',
      min: 0.01,
      max: 0.3,
      default: 0.08,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.05, stateful: false },
};

export const outlineGenerator: InlineGenerator = {
  def: outlineDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uLevel = uniform('level');
    const uWidth = uniform('width');
    return /* glsl */ `
// outline value-modifier: iso-contour bandpass around level
float ${fnName}(float v, vec2 p) {
  float lvl = clamp(${uLevel}, 0.0, 1.0);
  float w = clamp(${uWidth}, 0.01, 0.3);
  float d = abs(v - lvl);
  // soft band with AA-ish falloff
  float band = 1.0 - smoothstep(w * 0.45, w, d);
  return clamp(band, 0.0, 1.0);
}
`.trim();
  },
};
