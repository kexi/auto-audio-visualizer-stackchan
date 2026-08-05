import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Concentric rings from origin with per-ring radius wobble.
 */
export const concentricDef: GeneratorDefinition = {
  id: 'concentric',
  version: 1,
  category: 'source',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['geometric', 'ring'],
    motion: ['static'],
    affect: ['hypnotic'],
  },
  parameters: [
    {
      id: 'count',
      label: 'Count',
      kind: 'number',
      min: 2,
      max: 40,
      default: 12,
      modulatable: true,
    },
    {
      id: 'thickness',
      label: 'Thickness',
      kind: 'number',
      min: 0.005,
      max: 0.2,
      default: 0.03,
      modulatable: true,
    },
    {
      id: 'wobble',
      label: 'Wobble',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.25,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.45, stateful: false },
};

export const concentricGenerator: InlineGenerator = {
  def: concentricDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uCount = uniform('count');
    const uThickness = uniform('thickness');
    const uWobble = uniform('wobble');
    return /* glsl */ `
// concentric source: rings from origin with synthRand radius wobble
float ${fnName}(vec2 p) {
  float cnt = max(${uCount}, 2.0);
  float th = max(${uThickness}, 0.005);
  float wob = clamp(${uWobble}, 0.0, 1.0);
  float r = length(p);
  float maxR = 0.9;
  float d = 1e5;
  int n = int(min(cnt, 40.0));
  for (int i = 0; i < 40; i++) {
    if (i >= n) break;
    float base = (float(i) + 1.0) / cnt * maxR;
    float wr = synthRand(${seedUniform}, ${nsUniform}, uint(i));
    float ri = base * (1.0 + (wr - 0.5) * 2.0 * wob * 0.2);
    d = min(d, abs(r - ri));
  }
  float halfW = max(th * 0.5, 1e-4);
  float px = fwidth(d);
  float w = max(halfW, px * 0.75);
  return 1.0 - smoothstep(w - px, w + px, d);
}
`.trim();
  },
};
