import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Domain / tile coordinate repeat — fold space into a periodic lattice.
 */
export const repeatDef: GeneratorDefinition = {
  id: 'repeat',
  version: 1,
  category: 'modifier',
  costClass: 'micro',
  impl: 'inline',
  output: 'vector',
  tags: {
    material: ['geometric', 'tiling'],
    environment: ['patterned'],
    affect: ['repetitive', 'structured'],
  },
  parameters: [
    {
      id: 'count',
      label: 'Count',
      kind: 'number',
      min: 1,
      max: 16,
      default: 3,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.05, stateful: false },
};

export const repeatGenerator: InlineGenerator = {
  def: repeatDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uCount = uniform('count');
    return /* glsl */ `
// repeat coord-modifier: domain tile into count cells, origin-centered
vec2 ${fnName}(vec2 p) {
  float n = max(${uCount}, 1.0);
  return (fract(p * n + 0.5) - 0.5) / n;
}
`.trim();
  },
};
