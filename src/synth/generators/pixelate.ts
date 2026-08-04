import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Quantize coordinates to a pixel grid — blocky domain sampling.
 */
export const pixelateDef: GeneratorDefinition = {
  id: 'pixelate',
  version: 1,
  category: 'modifier',
  costClass: 'micro',
  impl: 'inline',
  output: 'vector',
  tags: {
    material: ['pixel', 'digital'],
    culturalTexture: ['lo-fi', 'retro'],
    affect: ['blocky', 'nostalgic'],
  },
  parameters: [
    {
      id: 'size',
      label: 'Size',
      kind: 'number',
      min: 0.002,
      max: 0.2,
      default: 0.03,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.05, stateful: false },
};

export const pixelateGenerator: InlineGenerator = {
  def: pixelateDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uSize = uniform('size');
    return /* glsl */ `
// pixelate coord-modifier: quantize p to a regular grid
vec2 ${fnName}(vec2 p) {
  float s = max(${uSize}, 0.002);
  return floor(p / s + 0.5) * s;
}
`.trim();
  },
};
