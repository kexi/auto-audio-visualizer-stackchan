import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Scooter slipstream — multi-origin thin rearward streams; cores lane-change via timeBucket.
 * Assembler multiplies return value by amount.
 */
export const scooterSlipstreamDef: GeneratorDefinition = {
  id: 'scooterSlipstream',
  version: 1,
  category: 'field',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    culturalTexture: ['taiwan-streetscape'],
    affect: ['kinetic', 'humid'],
  },
  parameters: [
    {
      id: 'riders',
      label: 'Riders',
      kind: 'int',
      min: 1,
      max: 5,
      default: 3,
      modulatable: true,
    },
    {
      id: 'pull',
      label: 'Pull',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
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
  cost: { passes: 0, relativeFill: 0.3, stateful: false },
};

export const scooterSlipstreamGenerator: InlineGenerator = {
  def: scooterSlipstreamDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uRiders = uniform('riders');
    const uPull = uniform('pull');
    return /* glsl */ `
// scooterSlipstream field: multi-origin thin rearward streams (amount in main)
vec2 ${fnName}(vec2 p) {
  int nR = clamp(${uRiders}, 1, 5);
  float pull = clamp(${uPull}, 0.0, 1.0);
  // lane-change bucket — origins rekey left/right slowly
  uint timeBucket = uint(floor(uTime * 0.45));
  vec2 disp = vec2(0.0);
  for (int i = 0; i < 5; i++) {
    if (i >= nR) break;
    uint idx = uint(i);
    // base x from seed + lane hop on timeBucket
    float baseX = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 1u)) - 0.5) * 1.5;
    float laneHop = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, timeBucket)) - 0.5) * 0.55;
    float ox = baseX + laneHop;
    // origins near bottom of screen
    float oy = -0.85 + 0.12 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 2u));
    vec2 o = vec2(ox, oy);
    vec2 d = p - o;
    // long thin slipstream stretching upward/rearward
    float along = max(-d.y, 0.0); // only behind (up from origin)
    float lat = abs(d.x);
    float thin = exp(-lat * lat * mix(28.0, 70.0, pull));
    float lenFall = exp(-along * mix(0.9, 2.2, 1.0 - pull));
    float core = thin * lenFall * step(0.0, -d.y + 0.02);
    // pull toward wake axis + slight upward stream
    float dx = -d.x * core * pull * 0.55;
    float dy = core * (0.12 + 0.22 * pull);
    // micro wobble of wake
    float wob = sin(along * 14.0 + uTime * 2.5 + float(i) * 1.7) * 0.02 * core;
    disp += vec2(dx + wob, dy);
  }
  return disp;
}
`.trim();
  },
};
