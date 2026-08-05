import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Moire beat — overlay near-frequency line sets; interference + slow freq drift.
 */
export const beatMoireDef: GeneratorDefinition = {
  id: 'beatMoire',
  version: 1,
  category: 'modifier',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    affect: ['optical', 'psychedelic', 'precise'],
  },
  parameters: [
    {
      id: 'freq',
      label: 'Freq',
      kind: 'number',
      min: 4,
      max: 80,
      default: 28,
      modulatable: true,
    },
    {
      id: 'angleDelta',
      label: 'Angle Delta',
      kind: 'number',
      min: 0,
      max: 30,
      default: 8,
      modulatable: true,
    },
    {
      id: 'mix',
      label: 'Mix',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.25, stateful: false },
};

export const beatMoireGenerator: InlineGenerator = {
  def: beatMoireDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uFreq = uniform('freq');
    const uAngleDelta = uniform('angleDelta');
    const uMix = uniform('mix');
    return /* glsl */ `
// beatMoire value-modifier: dual line sets at near frequencies → large beat patterns
float ${fnName}(float v, vec2 p) {
  float f0 = clamp(${uFreq}, 4.0, 80.0);
  float aDeg = clamp(${uAngleDelta}, 0.0, 30.0);
  float m = clamp(${uMix}, 0.0, 1.0);
  // slow freq delta drift
  float drift = 0.5 + 0.5 * sin(uTime * 0.07);
  float f1 = f0 + (1.2 + 2.5 * drift);
  float a0 = 0.3;
  float a1 = a0 + aDeg * 0.01745329251;
  float s0 = sin(p.x * cos(a0) * f0 + p.y * sin(a0) * f0);
  float s1 = sin(p.x * cos(a1) * f1 + p.y * sin(a1) * f1);
  // interference density
  float inter = s0 * s1;
  float dens = inter * 0.5 + 0.5;
  // soft dots flavor at crossings
  float dots = smoothstep(0.55, 0.95, abs(s0) * abs(s1));
  dens = max(dens, dots * 0.65);
  float outV = mix(v, v * dens, m * 0.65);
  outV = max(outV, dens * m * 0.45);
  return clamp(outV, 0.0, 1.0);
}
`.trim();
  },
};
