import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Coordinate mirror / fold modifier.
 * axis uniform as int: 0 = x, 1 = y, 2 = xy (abs on chosen axes).
 */
export const mirrorDef: GeneratorDefinition = {
  id: 'mirror',
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
      id: 'axis',
      label: 'Axis',
      kind: 'enum',
      options: ['x', 'y', 'xy'],
      default: 'x',
      modulatable: false,
    },
  ],
  cost: { passes: 0, relativeFill: 0.05, stateful: false },
};

export const mirrorGenerator: InlineGenerator = {
  def: mirrorDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uAxis = uniform('axis');
    return /* glsl */ `
// mirror coord-modifier: fold by abs; axis 0=x, 1=y, 2=xy
vec2 ${fnName}(vec2 p) {
  int axis = ${uAxis};
  if (axis == 0) {
    p.x = abs(p.x);
  } else if (axis == 1) {
    p.y = abs(p.y);
  } else {
    p = abs(p);
  }
  return p;
}
`.trim();
  },
};
