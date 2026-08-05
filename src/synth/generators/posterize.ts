import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Quantize density into discrete levels.
 */
export const posterizeDef: GeneratorDefinition = {
  id: 'posterize',
  version: 1,
  category: 'modifier',
  costClass: 'micro',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['print', 'poster'],
    affect: ['graphic'],
  },
  parameters: [
    {
      id: 'levels',
      label: 'Levels',
      kind: 'int',
      min: 2,
      max: 8,
      default: 4,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.05, stateful: false },
};

export const posterizeGenerator: InlineGenerator = {
  def: posterizeDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uLevels = uniform('levels');
    return /* glsl */ `
// posterize value-modifier: quantize density into discrete steps
float ${fnName}(float v, vec2 p) {
  float n = max(float(${uLevels}) - 1.0, 1.0);
  return floor(clamp(v, 0.0, 1.0) * n + 0.5) / n;
}
`.trim();
  },
};
