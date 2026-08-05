import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Harbor backwash — multi-direction weak flows reverse a beat late (asymmetric periods).
 * Assembler multiplies return value by amount.
 */
export const harborBackwashDef: GeneratorDefinition = {
  id: 'harborBackwash',
  version: 1,
  category: 'field',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    environment: ['maritime'],
    affect: ['suspended', 'melancholic'],
  },
  parameters: [
    {
      id: 'period',
      label: 'Period',
      kind: 'number',
      min: 1,
      max: 8,
      default: 3.5,
      modulatable: true,
    },
    {
      id: 'asymmetry',
      label: 'Asymmetry',
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

export const harborBackwashGenerator: InlineGenerator = {
  def: harborBackwashDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uPeriod = uniform('period');
    const uAsymmetry = uniform('asymmetry');
    return /* glsl */ `
// harborBackwash field: multi-dir weak flows with late reverse (amount in main)
vec2 ${fnName}(vec2 p) {
  float per = clamp(${uPeriod}, 1.0, 8.0);
  float asym = clamp(${uAsymmetry}, 0.0, 1.0);
  vec2 disp = vec2(0.0);
  for (int i = 0; i < 3; i++) {
    uint idx = uint(i);
    float ang = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 1u)) * 6.28318530718;
    vec2 dir = vec2(cos(ang), sin(ang));
    float lag = 0.15 + 0.35 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 2u));
    float phaseOff = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 3u)) * 6.28318530718;
    // asymmetric duty: forward short, back long when asymmetry high
    float duty = mix(0.5, 0.22, asym);
    float t = fract(uTime / per + lag * float(i) * 0.1 + phaseOff * 0.01);
    float wave;
    if (t < duty) {
      // forward push
      wave = sin(t / max(duty, 1e-3) * 3.14159265);
    } else {
      // reverse a beat late — longer half-period
      float u = (t - duty) / max(1.0 - duty, 1e-3);
      wave = -sin(u * 3.14159265) * mix(1.0, 0.65, asym);
    }
    // spatial modulation — weak harbor swirl
    float spat = 0.65 + 0.35 * sin(dot(p, dir) * 2.2 + phaseOff);
    disp += dir * wave * spat * 0.35;
  }
  return disp;
}
`.trim();
  },
};
