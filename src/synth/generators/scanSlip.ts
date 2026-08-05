import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Scanline slip — horizontal scan bands shift sideways; slip travels top→bottom.
 * Differs from slice: slice applies uniform shift per band; scanSlip propagates
 * active bands vertically with brief hard-boundary phase (edge-line intent structural only).
 */
export const scanSlipDef: GeneratorDefinition = {
  id: 'scanSlip',
  version: 1,
  category: 'modifier',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    material: ['broadcast'],
    affect: ['nervous', 'retro'],
  },
  parameters: [
    {
      id: 'bandH',
      label: 'Band H',
      kind: 'number',
      min: 0.01,
      max: 0.2,
      default: 0.05,
      modulatable: true,
    },
    {
      id: 'slip',
      label: 'Slip',
      kind: 'number',
      min: 0,
      max: 0.5,
      default: 0.18,
      modulatable: true,
    },
    {
      id: 'travelRate',
      label: 'Travel Rate',
      kind: 'number',
      min: 0.2,
      max: 4,
      default: 1.2,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.2, stateful: false },
};

export const scanSlipGenerator: InlineGenerator = {
  def: scanSlipDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uBandH = uniform('bandH');
    const uSlip = uniform('slip');
    const uTravelRate = uniform('travelRate');
    return /* glsl */ `
// scanSlip coord-modifier: traveling scan-band sideways slip (vs slice = uniform per-band shift)
// Edge bright-line intent is structural only (hard phase boundary); vector mod cannot add brightness.
vec2 ${fnName}(vec2 p) {
  float bh = clamp(${uBandH}, 0.01, 0.2);
  float sl = clamp(${uSlip}, 0.0, 0.5);
  float rate = clamp(${uTravelRate}, 0.2, 4.0);
  float bandF = floor((p.y + 1.0) / bh);
  uint bandId = uint(int(bandF));
  // intermittent travel via timeBucket — active front sweeps top→bottom
  uint timeBucket = uint(floor(uTime * rate));
  float travel = fract(float(timeBucket) * 0.07 + uTime * rate * 0.08);
  float y01 = p.y * 0.5 + 0.5;
  // live band group near traveling front
  float distFront = abs(y01 - travel);
  float bandLive = 1.0 - smoothstep(0.0, 0.12 + bh * 2.0, distFront);
  // phase decoupled from neighbors via band hash
  float phaseR = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(bandId, timeBucket));
  float dx = (phaseR - 0.5) * 2.0 * sl * bandLive;
  // hard boundary micro-step at band edges for structural "edge line" intent
  float edge = min(fract((p.y + 1.0) / bh), 1.0 - fract((p.y + 1.0) / bh));
  float edgeKick = (1.0 - smoothstep(0.0, 0.08, edge)) * bandLive * sl * 0.15;
  float edgeSign = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(bandId, 3u)) > 0.5 ? 1.0 : -1.0;
  p.x += dx + edgeKick * edgeSign;
  return p;
}
`.trim();
  },
};
