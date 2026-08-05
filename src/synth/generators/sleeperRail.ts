import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Night train sway — vertical progress, long lateral sway, micro vibe, edge weight, switch jolts.
 * Assembler multiplies return value by amount.
 */
export const sleeperRailDef: GeneratorDefinition = {
  id: 'sleeperRail',
  version: 1,
  category: 'field',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    affect: ['nocturnal', 'travelling', 'lonely'],
  },
  parameters: [
    {
      id: 'speed',
      label: 'Speed',
      kind: 'number',
      min: 0,
      max: 2,
      default: 0.8,
      modulatable: true,
    },
    {
      id: 'swayLong',
      label: 'Sway Long',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.5,
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

export const sleeperRailGenerator: InlineGenerator = {
  def: sleeperRailDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uSpeed = uniform('speed');
    const uSwayLong = uniform('swayLong');
    return /* glsl */ `
// sleeperRail field: night train vertical progress + long sway + micro vibe + jolts
vec2 ${fnName}(vec2 p) {
  float spd = max(${uSpeed}, 0.0);
  float sway = clamp(${uSwayLong}, 0.0, 1.0);
  // vertical progress
  float dy = spd * 0.12 * (0.85 + 0.15 * sin(uTime * 0.5));
  // long-period lateral sway
  float dxLong = sin(uTime * 0.18 + p.y * 0.4) * sway * 0.14;
  // short micro vibe (rail chatter)
  float dxMicro = sin(uTime * 11.0 + p.y * 40.0) * 0.012
    + sin(uTime * 17.5 + p.x * 8.0) * 0.006;
  // stronger near left/right edges
  float edge = smoothstep(0.35, 0.95, abs(p.x));
  float edgeW = 0.55 + 0.85 * edge;
  // point-switch jolts via timeBucket
  uint timeBucket = uint(floor(uTime * (0.4 + spd * 0.35)));
  float joltR = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(timeBucket, 11u));
  float jolt = step(0.88, joltR) * (0.08 + 0.12 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(timeBucket, 12u)));
  float joltSign = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(timeBucket, 13u)) > 0.5 ? 1.0 : -1.0;
  float dx = (dxLong + dxMicro * edgeW + jolt * joltSign) * edgeW;
  return vec2(dx, dy);
}
`.trim();
  },
};
