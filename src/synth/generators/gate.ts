import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Temporal gate — timeBucket + synthRand pass/block density probabilistically.
 */
export const gateDef: GeneratorDefinition = {
  id: 'gate',
  version: 1,
  category: 'modifier',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    motion: ['flicker'],
    affect: ['rhythmic', 'abrasive'],
  },
  parameters: [
    {
      id: 'rate',
      label: 'Rate',
      kind: 'number',
      min: 0.5,
      max: 8,
      default: 2,
      modulatable: true,
    },
    {
      id: 'duty',
      label: 'Duty',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.65,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.15, stateful: false },
};

export const gateGenerator: InlineGenerator = {
  def: gateDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uRate = uniform('rate');
    const uDuty = uniform('duty');
    return /* glsl */ `
// gate value-modifier: temporal pass/block via timeBucket + synthRand (beat-linkable rate)
float ${fnName}(float v, vec2 p) {
  float rate = clamp(${uRate}, 0.5, 8.0);
  float duty = clamp(${uDuty}, 0.0, 1.0);
  // beat-linked boost: higher uBeat tightens/opens gate slightly via duty
  float dutyEff = clamp(duty + (uBeat - 0.5) * 0.15, 0.0, 1.0);
  uint timeBucket = uint(floor(uTime * rate));
  float r = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(timeBucket, 7u));
  // pass if rand under duty
  float open = step(r, dutyEff);
  // brief soft edges within bucket via fractional phase
  float frac = fract(uTime * rate);
  float edgeSoft = smoothstep(0.0, 0.08, frac) * (1.0 - smoothstep(0.92, 1.0, frac));
  // hard open/close primary; edgeSoft only trims chatter
  return v * open * mix(0.92, 1.0, edgeSoft);
}
`.trim();
  },
};
