import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Mix density invert by amount.
 */
export const invertDef: GeneratorDefinition = {
  id: 'invert',
  version: 1,
  category: 'modifier',
  costClass: 'micro',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['negative'],
    affect: ['inverted'],
  },
  parameters: [
    {
      id: 'amount',
      label: 'Amount',
      kind: 'number',
      min: 0,
      max: 1,
      default: 1,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.05, stateful: false },
};

export const invertGenerator: InlineGenerator = {
  def: invertDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uAmount = uniform('amount');
    return /* glsl */ `
// invert value-modifier: mix toward 1-v by amount
float ${fnName}(float v, vec2 p) {
  float amt = clamp(${uAmount}, 0.0, 1.0);
  return mix(v, 1.0 - v, amt);
}
`.trim();
  },
};
