import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Swirl / vortex displacement around origin.
 * Returns unit tangent * strength * falloff(radius). Assembler multiplies by amount.
 */
export const vortexDef: GeneratorDefinition = {
  id: 'vortex',
  version: 1,
  category: 'field',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    material: ['fluid'],
    motion: ['swirl', 'rotational'],
    affect: ['hypnotic'],
  },
  parameters: [
    {
      id: 'strength',
      label: 'Strength',
      kind: 'number',
      min: 0,
      max: 2,
      default: 1,
      modulatable: true,
    },
    {
      id: 'falloff',
      label: 'Falloff',
      kind: 'number',
      min: 0.1,
      max: 4,
      default: 1.5,
      modulatable: true,
    },
    {
      id: 'amount',
      label: 'Amount',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.2,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.25, stateful: false },
};

export const vortexGenerator: InlineGenerator = {
  def: vortexDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uStrength = uniform('strength');
    const uFalloff = uniform('falloff');
    return /* glsl */ `
// vortex field: unit tangent * strength * radial falloff (amount applied in main)
vec2 ${fnName}(vec2 p) {
  float r = length(p);
  float str = max(${uStrength}, 0.0);
  float fo = max(${uFalloff}, 0.1);
  vec2 tangent = r > 1e-5 ? vec2(-p.y, p.x) / r : vec2(0.0);
  float atten = exp(-(r * r) / (fo * fo));
  return tangent * str * atten;
}
`.trim();
  },
};
