import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Level curve — raise or crush density with a power curve.
 */
export const gammaDef: GeneratorDefinition = {
  id: 'gamma',
  version: 1,
  category: 'modifier',
  costClass: 'micro',
  impl: 'inline',
  output: 'field',
  tags: {
    affect: ['graphic'],
  },
  parameters: [
    {
      id: 'curve',
      label: 'Curve',
      kind: 'number',
      min: 0.2,
      max: 5,
      default: 0.8,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.05, stateful: false },
};

export const gammaGenerator: InlineGenerator = {
  def: gammaDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uCurve = uniform('curve');
    return /* glsl */ `
// gamma value-modifier: pow() level curve (<1 lifts, >1 crushes)
float ${fnName}(float v, vec2 p) {
  float c = clamp(${uCurve}, 0.2, 5.0);
  float x = clamp(v, 0.0, 1.0);
  return clamp(pow(x, c), 0.0, 1.0);
}
`.trim();
  },
};
