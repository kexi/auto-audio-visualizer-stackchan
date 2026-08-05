import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Hill climb gear ratios — stepwise vertical stretch, meander, accel/decel cycles.
 * Assembler multiplies return value by amount.
 */
export const hillClimbDef: GeneratorDefinition = {
  id: 'hillClimb',
  version: 1,
  category: 'field',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    affect: ['effortful', 'travelling', 'hypnotic'],
  },
  parameters: [
    {
      id: 'gears',
      label: 'Gears',
      kind: 'int',
      min: 2,
      max: 6,
      default: 4,
      modulatable: true,
    },
    {
      id: 'meander',
      label: 'Meander',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.4,
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

export const hillClimbGenerator: InlineGenerator = {
  def: hillClimbDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uGears = uniform('gears');
    const uMeander = uniform('meander');
    return /* glsl */ `
// hillClimb field: gear-stepped vertical stretch + meander + accel/decel (amount in main)
vec2 ${fnName}(vec2 p) {
  int nG = clamp(${uGears}, 2, 6);
  float me = clamp(${uMeander}, 0.0, 1.0);
  float y01 = clamp(p.y * 0.5 + 0.5, 0.0, 1.0);
  float gearF = floor(y01 * float(nG));
  float gearT = fract(y01 * float(nG));
  // harder gears higher up: smaller vertical advance (compress dy)
  float gearRatio = 1.0 - gearF / float(nG) * 0.75;
  // short accel + long decel within each gear segment
  float cycle = fract(uTime * 0.22 + gearF * 0.17);
  float accel = smoothstep(0.0, 0.18, cycle) * (1.0 - smoothstep(0.18, 1.0, cycle));
  // decel dominates most of the period
  float drive = mix(0.35, 1.0, accel);
  float dy = (0.5 - gearT) * (1.0 - gearRatio) * drive * 0.55;
  // light horizontal meander
  float dx = sin(p.y * 3.5 + uTime * 0.4 + gearF) * me * 0.12
    + sin(p.y * 1.2 + uTime * 0.15) * me * 0.06;
  return vec2(dx, dy);
}
`.trim();
  },
};
