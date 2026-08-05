import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Deinterlace comb approximation — odd/even scanlines shift differently with temporal lag.
 * Approximation: no true field history; lag is simulated via delayed time phase per parity.
 */
export const interlaceCombDef: GeneratorDefinition = {
  id: 'interlaceComb',
  version: 1,
  category: 'modifier',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    affect: ['archival', 'technical', 'abrasive'],
  },
  parameters: [
    {
      id: 'lineH',
      label: 'Line H',
      kind: 'number',
      min: 0.002,
      max: 0.02,
      default: 0.008,
      modulatable: true,
    },
    {
      id: 'comb',
      label: 'Comb',
      kind: 'number',
      min: 0,
      max: 0.5,
      default: 0.18,
      modulatable: true,
    },
    {
      id: 'rate',
      label: 'Rate',
      kind: 'number',
      min: 0.5,
      max: 8,
      default: 2.0,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.2, stateful: false },
};

export const interlaceCombGenerator: InlineGenerator = {
  def: interlaceCombDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uLineH = uniform('lineH');
    const uComb = uniform('comb');
    const uRate = uniform('rate');
    return /* glsl */ `
// interlaceComb coord-modifier: odd/even scanline horizontal comb
// Approximation: no true field history — temporal lag via delayed phase per parity line.
vec2 ${fnName}(vec2 p) {
  float lh = clamp(${uLineH}, 0.002, 0.02);
  float comb = clamp(${uComb}, 0.0, 0.5);
  float rate = clamp(${uRate}, 0.5, 8.0);
  float lineF = floor((p.y + 1.0) / lh);
  int lineI = int(lineF);
  int parity = lineI & 1;
  uint timeBucket = uint(floor(uTime * rate));
  // even field "current", odd field lagged one bucket — comb on motion
  uint bucketEven = timeBucket;
  uint bucketOdd = timeBucket > 0u ? timeBucket - 1u : 0u;
  uint b = parity == 0 ? bucketEven : bucketOdd;
  float r = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(lineI), b));
  // motion-like global drift component differs by lag
  float driftNow = sin(uTime * rate * 0.7) * comb;
  float driftLag = sin((uTime - 1.0 / max(rate, 0.5)) * rate * 0.7) * comb;
  float drift = parity == 0 ? driftNow : driftLag;
  float dx = (r - 0.5) * 2.0 * comb * 0.55 + drift;
  p.x += dx;
  return p;
}
`.trim();
  },
};
