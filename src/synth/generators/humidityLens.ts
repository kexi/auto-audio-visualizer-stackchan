import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Humidity lens field — soft density blobs refract coordinates inside.
 * Assembler multiplies return value by amount.
 */
export const humidityLensDef: GeneratorDefinition = {
  id: 'humidityLens',
  version: 1,
  category: 'field',
  costClass: 'medium',
  impl: 'inline',
  output: 'vector',
  tags: {
    affect: ['humid', 'dreamy', 'nocturnal'],
  },
  parameters: [
    {
      id: 'blobs',
      label: 'Blobs',
      kind: 'number',
      min: 1,
      max: 6,
      default: 3,
      modulatable: true,
    },
    {
      id: 'refraction',
      label: 'Refraction',
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
  cost: { passes: 0, relativeFill: 0.5, stateful: false },
};

export const humidityLensGenerator: InlineGenerator = {
  def: humidityLensDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uBlobs = uniform('blobs');
    const uRefraction = uniform('refraction');
    return /* glsl */ `
// humidityLens field: soft blob refraction with slow merge/split (amount in main)
vec2 ${fnName}(vec2 p) {
  int n = clamp(int(${uBlobs}), 1, 6);
  float refr = clamp(${uRefraction}, 0.0, 1.0);
  vec2 disp = vec2(0.0);
  for (int i = 0; i < 6; i++) {
    if (i >= n) break;
    uint idx = uint(i);
    float bx = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 1u)) - 0.5) * 1.5;
    float by = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 2u)) - 0.5) * 1.5;
    // very slow drift — merge/split feel
    float spd = 0.04 + 0.05 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 3u));
    float phase = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 4u)) * 6.28318530718;
    bx += sin(uTime * spd + phase) * 0.25;
    by += cos(uTime * spd * 0.85 + phase * 1.3) * 0.2;
    vec2 c = vec2(bx, by);
    float rad = 0.2 + 0.25 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 5u));
    rad *= 0.9 + 0.15 * sin(uTime * 0.12 + phase);
    vec2 d = p - c;
    float r = length(d);
    float soft = exp(-r * r / max(rad * rad * 1.6, 1e-4));
    // refraction-like bend: gradient of density blob
    vec2 grad = d / max(r, 1e-4) * soft;
    disp += grad * refr * 0.9;
  }
  return disp;
}
`.trim();
  },
};
