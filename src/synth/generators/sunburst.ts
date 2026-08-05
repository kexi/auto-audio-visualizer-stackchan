import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Sunburst (集中線) — radial rays from the center; per-ray width jitter from synthRand.
 */
export const sunburstDef: GeneratorDefinition = {
  id: 'sunburst',
  version: 1,
  category: 'source',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    culturalTexture: ['manga'],
    motion: ['radial'],
    affect: ['dramatic', 'graphic'],
  },
  parameters: [
    {
      id: 'rays',
      label: 'Rays',
      kind: 'int',
      min: 8,
      max: 64,
      default: 24,
      modulatable: true,
    },
    {
      id: 'duty',
      label: 'Duty',
      kind: 'number',
      min: 0.05,
      max: 0.9,
      default: 0.4,
      modulatable: true,
    },
    {
      id: 'wobble',
      label: 'Wobble',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.45,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.4, stateful: false },
};

export const sunburstGenerator: InlineGenerator = {
  def: sunburstDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uRays = uniform('rays');
    const uDuty = uniform('duty');
    const uWobble = uniform('wobble');
    return /* glsl */ `
// sunburst source: 集中線 — angular wedges with per-ray width/length jitter
float ${fnName}(vec2 p) {
  int nR = clamp(${uRays}, 8, 64);
  float duty = clamp(${uDuty}, 0.05, 0.9);
  float wob = clamp(${uWobble}, 0.0, 1.0);
  float rad = length(p);
  float ang = atan(p.y, p.x);
  // 0..1 around the circle; wraps seamlessly because nR is an integer
  float t = ang * 0.15915494309 + 0.5;
  float g = t * float(nR);
  float idx = floor(g);
  uint ri = uint(int(idx));
  // per-ray width jitter
  float r0 = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ri, 11u));
  float halfW = clamp(duty * 0.5 * mix(1.0, 0.3 + 1.4 * r0, wob), 0.02, 0.49);
  // per-ray inner start radius — ragged 集中線 ends
  float r1 = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ri, 12u));
  float inner = mix(0.06, 0.06 + 0.34 * r1, wob);
  // wedge is centered in its slot: distance to the slot center vs half width
  float d = abs(fract(g) - 0.5);
  float px = clamp(fwidth(g), 1e-5, 0.5);
  float w = max(halfW, px * 0.75);
  float ray = 1.0 - smoothstep(w - px, w + px, d);
  // fade out over the ragged inner radius and at the very center
  float radial = smoothstep(inner, inner + 0.18, rad);
  return clamp(ray * radial, 0.0, 1.0);
}
`.trim();
  },
};
