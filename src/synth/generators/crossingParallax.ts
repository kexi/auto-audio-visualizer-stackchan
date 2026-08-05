import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Crossing parallax — interlocking depth-band layers shift at different speeds;
 * signal-cycle stop then restart via timeBucket.
 * Assembler multiplies return value by amount.
 */
export const crossingParallaxDef: GeneratorDefinition = {
  id: 'crossingParallax',
  version: 1,
  category: 'field',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    environment: ['urban'],
    affect: ['metropolitan', 'layered', 'restless'],
  },
  parameters: [
    {
      id: 'layers',
      label: 'Layers',
      kind: 'int',
      min: 2,
      max: 5,
      default: 3,
      modulatable: true,
    },
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

export const crossingParallaxGenerator: InlineGenerator = {
  def: crossingParallaxDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uLayers = uniform('layers');
    const uSpeed = uniform('speed');
    return /* glsl */ `
// crossingParallax field: band depth layers + signal-cycle stop/start (amount in main)
vec2 ${fnName}(vec2 p) {
  int nL = clamp(${uLayers}, 2, 5);
  float spd = clamp(${uSpeed}, 0.0, 2.0);
  // signal cycle: stop then restart in different directions
  uint timeBucket = uint(floor(uTime * 0.55));
  float phase = fract(uTime * 0.55);
  // red-ish hold early in cycle, green motion later
  float go = smoothstep(0.18, 0.32, phase) * (1.0 - smoothstep(0.88, 0.98, phase));
  vec2 disp = vec2(0.0);
  float y01 = p.y * 0.5 + 0.5;
  for (int i = 0; i < 5; i++) {
    if (i >= nL) break;
    uint idx = uint(i);
    // interlocking horizontal bands
    float bandH = 1.0 / float(nL);
    float bandCenter = (float(i) + 0.5) * bandH;
    float bandMask = 1.0 - smoothstep(0.0, bandH * 0.55, abs(y01 - bandCenter));
    // each layer gets a direction and speed from seed + cycle bucket
    float ang = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, timeBucket)) * 6.28318530718;
    // bias layers to alternate primary axes (crossing feel)
    if ((i & 1) == 0) {
      ang = mix(0.0, ang, 0.35); // prefer horizontal
    } else {
      ang = mix(1.57079632679, ang, 0.35); // prefer vertical
    }
    vec2 dir = vec2(cos(ang), sin(ang));
    float layerSpd = (0.35 + 0.65 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 2u))) * spd;
    float mag = layerSpd * go * 0.14 * (0.7 + 0.3 * float(i) / max(float(nL - 1), 1.0));
    // slight within-band parallax gradient
    float local = (y01 - bandCenter) / max(bandH, 1e-3);
    disp += dir * mag * bandMask * (1.0 + local * 0.25);
  }
  return disp;
}
`.trim();
  },
};
