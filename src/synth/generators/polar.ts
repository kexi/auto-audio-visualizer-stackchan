import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Classic VJ polar warp — twist by radius then zoom.
 */
export const polarDef: GeneratorDefinition = {
  id: 'polar',
  version: 1,
  category: 'modifier',
  costClass: 'micro',
  impl: 'inline',
  output: 'vector',
  tags: {
    material: ['geometric'],
    affect: ['psychedelic'],
  },
  parameters: [
    {
      id: 'twist',
      label: 'Twist',
      kind: 'number',
      min: 0,
      max: 2,
      default: 0.5,
      modulatable: true,
    },
    {
      id: 'zoom',
      label: 'Zoom',
      kind: 'number',
      min: 0.2,
      max: 4,
      default: 1.0,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.05, stateful: false },
};

export const polarGenerator: InlineGenerator = {
  def: polarDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uTwist = uniform('twist');
    const uZoom = uniform('zoom');
    return /* glsl */ `
// polar coord-modifier: classic angle/radius warp with twist + zoom
vec2 ${fnName}(vec2 p) {
  float tw = clamp(${uTwist}, 0.0, 2.0);
  float zm = clamp(${uZoom}, 0.2, 4.0);
  float r = length(p);
  float a = atan(p.y, p.x) + tw * r;
  r *= zm;
  return vec2(cos(a), sin(a)) * r;
}
`.trim();
  },
};
