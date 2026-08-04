import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Soft threshold / posterize of density around a level.
 */
export const thresholdDef: GeneratorDefinition = {
  id: 'threshold',
  version: 1,
  category: 'modifier',
  costClass: 'micro',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['hard-edge', 'print'],
    affect: ['graphic', 'binary'],
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
      id: 'softness',
      label: 'Softness',
      kind: 'number',
      min: 0,
      max: 0.5,
      default: 0.05,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.05, stateful: false },
};

export const thresholdGenerator: InlineGenerator = {
  def: thresholdDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uLevel = uniform('level');
    const uSoftness = uniform('softness');
    return /* glsl */ `
// threshold value-modifier: softstep around level
float ${fnName}(float v, vec2 p) {
  float lvl = clamp(${uLevel}, 0.0, 1.0);
  float soft = max(${uSoftness}, 1e-5);
  return smoothstep(lvl - soft, lvl + soft, v);
}
`.trim();
  },
};
