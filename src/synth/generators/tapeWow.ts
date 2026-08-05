import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Tape wow/flutter — horizontal coord wobble with occasional short flutter.
 * Assembler multiplies return value by amount.
 */
export const tapeWowDef: GeneratorDefinition = {
  id: 'tapeWow',
  version: 1,
  category: 'field',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    material: ['tape'],
    affect: ['analog', 'tender', 'unstable'],
  },
  parameters: [
    {
      id: 'wow',
      label: 'Wow',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.4,
      modulatable: true,
    },
    {
      id: 'flutter',
      label: 'Flutter',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.35,
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

export const tapeWowGenerator: InlineGenerator = {
  def: tapeWowDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uWow = uniform('wow');
    const uFlutter = uniform('flutter');
    return /* glsl */ `
// tapeWow field: multi-sine horizontal wow + short flutter (amount in main)
vec2 ${fnName}(vec2 p) {
  float wowAmt = clamp(${uWow}, 0.0, 1.0);
  float flutAmt = clamp(${uFlutter}, 0.0, 1.0);
  // period varies slightly with screen position
  float pvar = 1.0 + 0.15 * sin(p.y * 3.1) + 0.1 * sin(p.x * 1.7);
  float w1 = sin(uTime * 0.9 * pvar + p.y * 2.0);
  float w2 = sin(uTime * 1.7 * pvar + p.y * 4.3 + 1.2);
  float w3 = sin(uTime * 0.45 + p.x * 0.8);
  float dx = (w1 * 0.55 + w2 * 0.3 + w3 * 0.15) * wowAmt;
  // occasional short flutter via timeBucket
  uint timeBucket = uint(floor(uTime * 6.0));
  float fR = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(timeBucket, 3u));
  float flut = step(0.82, fR) * (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(timeBucket, 4u)) - 0.5) * 2.0;
  flut *= flutAmt * (0.7 + 0.3 * sin(uTime * 40.0 + p.y * 12.0));
  dx += flut;
  return vec2(dx, 0.0);
}
`.trim();
  },
};
