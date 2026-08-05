import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Sweet polymeter — short bands + point clusters with uneven meters A/B.
 */
export const polymeterDef: GeneratorDefinition = {
  id: 'polymeter',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    affect: ['sweet', 'intricate', 'uneasy'],
    motion: ['polyrhythm'],
  },
  parameters: [
    {
      id: 'meterA',
      label: 'Meter A',
      kind: 'int',
      min: 2,
      max: 7,
      default: 3,
      modulatable: true,
    },
    {
      id: 'meterB',
      label: 'Meter B',
      kind: 'int',
      min: 2,
      max: 9,
      default: 5,
      modulatable: true,
    },
    {
      id: 'softness',
      label: 'Softness',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.45,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.5, stateful: false },
};

export const polymeterGenerator: InlineGenerator = {
  def: polymeterDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uMeterA = uniform('meterA');
    const uMeterB = uniform('meterB');
    const uSoftness = uniform('softness');
    return /* glsl */ `
// polymeter source: uneven meters A/B — large form only when periods align
float ${fnName}(vec2 p) {
  int mA = clamp(${uMeterA}, 2, 7);
  int mB = clamp(${uMeterB}, 2, 9);
  float soft = clamp(${uSoftness}, 0.0, 1.0);
  float fA = float(mA);
  float fB = float(mB);
  // each period advances at different speed
  float tA = uTime * 0.55;
  float tB = uTime * 0.55 * (fA / max(fB, 1.0));
  float x01 = p.x * 0.5 + 0.5;
  float y01 = p.y * 0.5 + 0.5;
  // meter A: horizontal band cells
  float cellA = fract(x01 * fA * 2.0 + tA);
  float bandA = abs(cellA - 0.5);
  // pattern like 3-3-2 style accent via synthRand per cell
  float idA = floor(x01 * fA * 2.0 + tA);
  uint ia = uint(int(idA));
  float accentA = step(0.55, synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ia, 1u)));
  float halfA = mix(0.18, 0.32, accentA);
  float edgeSoft = mix(0.02, 0.12, soft);
  float densA = 1.0 - smoothstep(halfA - edgeSoft, halfA + edgeSoft, bandA);
  densA *= smoothstep(0.0, 0.15 + soft * 0.2, y01) * smoothstep(1.0, 0.75 - soft * 0.15, y01);
  // meter B: vertical point clusters
  float cellB = fract(y01 * fB * 1.5 + tB);
  float idB = floor(y01 * fB * 1.5 + tB);
  uint ib = uint(int(idB));
  float cx = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ib, 2u));
  float cy = cellB;
  float dPt = length(vec2((x01 - cx) * 1.4, (fract(y01 * fB * 1.5 + tB) - 0.5) * 0.8));
  float rad = 0.04 + 0.03 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ib, 3u));
  float densB = 1.0 - smoothstep(rad, rad + edgeSoft * 1.5, dPt);
  // short diagonal ticks on B
  float tick = abs((x01 - cx) - (fract(y01 * fB + tB * 0.5) - 0.5) * 0.3);
  float densTick = (1.0 - smoothstep(0.01, 0.01 + edgeSoft, tick))
    * smoothstep(0.2, 0.0, abs(fract(y01 * fB + tB * 0.5) - 0.5));
  densB = max(densB, densTick * 0.7);
  // large form when periods align (phase coincidence)
  float phaseA = fract(tA / fA);
  float phaseB = fract(tB / fB);
  float align = 1.0 - smoothstep(0.0, 0.12 + soft * 0.08, abs(phaseA - phaseB));
  float bloom = align * (0.25 + 0.35 * densA * densB);
  float dens = max(max(densA * 0.85, densB * 0.9), bloom);
  return clamp(dens, 0.0, 1.0);
}
`.trim();
  },
};
