import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Kaleidoscope angle fold — coord modifier.
 */
export const kaleidoDef: GeneratorDefinition = {
  id: 'kaleido',
  version: 1,
  category: 'modifier',
  costClass: 'micro',
  impl: 'inline',
  output: 'vector',
  tags: {
    material: ['geometric'],
    environment: ['kaleidoscope'],
    affect: ['symmetrical'],
  },
  parameters: [
    {
      id: 'segments',
      label: 'Segments',
      kind: 'int',
      min: 2,
      max: 16,
      default: 6,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.05, stateful: false },
};

export const kaleidoGenerator: InlineGenerator = {
  def: kaleidoDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uSegments = uniform('segments');
    return /* glsl */ `
// kaleido coord-modifier: angular fold into one sector
vec2 ${fnName}(vec2 p) {
  int segs = clamp(${uSegments}, 2, 16);
  float TAU = 6.28318530718;
  float sector = TAU / float(segs);
  float ang = atan(p.y, p.x);
  float r = length(p);
  float a = abs(mod(ang, sector * 2.0) - sector);
  return vec2(cos(a), sin(a)) * r;
}
`.trim();
  },
};
