import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Mooring ropes — thick intertwined sine strands diagonal across the frame.
 */
export const mooringRopeDef: GeneratorDefinition = {
  id: 'mooringRope',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    environment: ['maritime'],
    affect: ['tactile', 'slow'],
  },
  parameters: [
    {
      id: 'strands',
      label: 'Strands',
      kind: 'int',
      min: 2,
      max: 6,
      default: 3,
      modulatable: true,
    },
    {
      id: 'twist',
      label: 'Twist',
      kind: 'number',
      min: 1,
      max: 8,
      default: 3.5,
      modulatable: true,
    },
    {
      id: 'tension',
      label: 'Tension',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.5,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.5, stateful: false },
};

export const mooringRopeGenerator: InlineGenerator = {
  def: mooringRopeDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uStrands = uniform('strands');
    const uTwist = uniform('twist');
    const uTension = uniform('tension');
    return /* glsl */ `
// mooringRope source: intertwined diagonal sine strands with crossing invert
float ${fnName}(vec2 p) {
  int n = clamp(${uStrands}, 2, 6);
  float tw = clamp(${uTwist}, 1.0, 8.0);
  float ten = clamp(${uTension}, 0.0, 1.0);
  // diagonal axis across frame
  float along = (p.x + p.y) * 0.70710678;
  float across = (-p.x + p.y) * 0.70710678;
  // slow tension stretch
  float stretch = 1.0 + 0.12 * ten * sin(uTime * 0.35);
  along *= stretch;
  float dens = 0.0;
  float nearest = 1e5;
  float second = 1e5;
  for (int i = 0; i < 6; i++) {
    if (i >= n) break;
    uint idx = uint(i);
    float phase = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 1u)) * 6.28318530718;
    float amp = 0.06 + 0.08 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 2u));
    amp *= mix(1.15, 0.7, ten);
    float freq = tw * (0.85 + 0.3 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 3u)));
    float off = (float(i) - float(n - 1) * 0.5) * 0.045;
    float yWave = sin(along * freq + phase + uTime * 0.25) * amp + off;
    float d = abs(across - yWave);
    if (d < nearest) {
      second = nearest;
      nearest = d;
    } else if (d < second) {
      second = d;
    }
    float halfW = max(0.022, 1e-4);
    float px = fwidth(d);
    float w = max(halfW, px * 0.75);
    float strand = 1.0 - smoothstep(w - px, w + px, d);
    dens = max(dens, strand);
  }
  // shade invert at crossings (two strands close)
  float cross = 1.0 - smoothstep(0.0, 0.04, second - nearest);
  dens = mix(dens, 1.0 - dens * 0.85, cross * 0.55 * step(0.2, dens));
  return clamp(dens, 0.0, 1.0);
}
`.trim();
  },
};
