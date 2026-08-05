import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Cheap scaler ringing — edge vicinity via fwidth(v); thin alternating bright/dark rings.
 * Approximation: no neighborhood samples available, so fwidth(v) stands in for edge detect.
 */
export const scalerRingingDef: GeneratorDefinition = {
  id: 'scalerRinging',
  version: 1,
  category: 'modifier',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['consumer-tech'],
    affect: ['harsh', 'nostalgic'],
  },
  parameters: [
    {
      id: 'rings',
      label: 'Rings',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.5,
      modulatable: true,
    },
    {
      id: 'harshness',
      label: 'Harshness',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.45,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.2, stateful: false },
};

export const scalerRingingGenerator: InlineGenerator = {
  def: scalerRingingDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uRings = uniform('rings');
    const uHarshness = uniform('harshness');
    return /* glsl */ `
// scalerRinging value-modifier: cheap scaler edge ringing
// Approximation: no neighborhood samples available — fwidth(v) stands in for edge detect.
float ${fnName}(float v, vec2 p) {
  float rings = clamp(${uRings}, 0.0, 1.0);
  float harsh = clamp(${uHarshness}, 0.0, 1.0);
  // edge magnitude from density gradient
  float edge = abs(fwidth(v));
  float e = smoothstep(0.0, mix(0.06, 0.02, harsh), edge * mix(6.0, 14.0, harsh));
  // thin alternating bright/dark ringing along the edge band
  float phase = v * mix(18.0, 48.0, rings) + p.x * 2.0 + p.y * 1.5;
  float ring = sin(phase);
  // AA the ring zero-crossings slightly via fwidth of phase proxy
  float aa = max(fwidth(phase), 1e-4);
  float ringSoft = ring / (1.0 + aa * 4.0);
  float ringAmt = e * rings * mix(0.18, 0.55, harsh);
  float outV = v + ringSoft * ringAmt;
  // harshness pushes toward clipped overshoot
  outV = mix(outV, clamp(outV * (1.0 + harsh * 0.35) - harsh * 0.08, 0.0, 1.0), harsh * e);
  return clamp(outV, 0.0, 1.0);
}
`.trim();
  },
};
