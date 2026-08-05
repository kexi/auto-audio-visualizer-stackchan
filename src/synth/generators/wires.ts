import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Sagging power lines — few catenary/parabola curves across the view.
 */
export const wiresDef: GeneratorDefinition = {
  id: 'wires',
  version: 1,
  category: 'source',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    environment: ['urban', 'suburban'],
    motion: ['static'],
    affect: ['nostalgic'],
  },
  parameters: [
    {
      id: 'count',
      label: 'Count',
      kind: 'int',
      min: 1,
      max: 8,
      default: 4,
      modulatable: true,
    },
    {
      id: 'sag',
      label: 'Sag',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.45,
      modulatable: true,
    },
    {
      id: 'thickness',
      label: 'Thickness',
      kind: 'number',
      min: 0.002,
      max: 0.05,
      default: 0.008,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.4, stateful: false },
};

export const wiresGenerator: InlineGenerator = {
  def: wiresDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uCount = uniform('count');
    const uSag = uniform('sag');
    const uThickness = uniform('thickness');
    return /* glsl */ `
// wires source: sagging parabolic power lines with fwidth AA
float ${fnName}(vec2 p) {
  int cnt = clamp(${uCount}, 1, 8);
  float sagAmt = clamp(${uSag}, 0.0, 1.0);
  float th = max(${uThickness}, 0.002);
  float t = clamp(p.x * 0.5 + 0.5, 0.0, 1.0);
  float d = 1e5;
  for (int i = 0; i < 8; i++) {
    if (i >= cnt) break;
    uint idx = uint(i);
    float yL = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 0u)) - 0.5) * 1.4;
    float yR = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 1u)) - 0.5) * 1.4;
    float sagVar = 0.5 + 0.5 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 2u));
    float yWire = mix(yL, yR, t) + sagAmt * 4.0 * t * (1.0 - t) * sagVar * 0.35;
    d = min(d, abs(p.y - yWire));
  }
  float halfW = max(th * 0.5, 1e-4);
  float px = fwidth(d);
  float w = max(halfW, px * 0.75);
  return 1.0 - smoothstep(w - px, w + px, d);
}
`.trim();
  },
};
