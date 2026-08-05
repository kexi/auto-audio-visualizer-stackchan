import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Contour lines (等高線) — iso-value bands of synthRand fbm, fwidth-AA.
 */
export const contourDef: GeneratorDefinition = {
  id: 'contour',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    environment: ['terrain'],
    affect: ['technical', 'calm'],
  },
  parameters: [
    {
      id: 'scale',
      label: 'Scale',
      kind: 'number',
      min: 0.5,
      max: 6,
      default: 2,
      modulatable: true,
    },
    {
      id: 'levels',
      label: 'Levels',
      kind: 'int',
      min: 3,
      max: 20,
      default: 9,
      modulatable: true,
    },
    {
      id: 'thickness',
      label: 'Thickness',
      kind: 'number',
      min: 0.01,
      max: 0.2,
      default: 0.07,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.6, stateful: false },
};

export const contourGenerator: InlineGenerator = {
  def: contourDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uScale = uniform('scale');
    const uLevels = uniform('levels');
    const uThickness = uniform('thickness');
    const vnoise = `${fnName}_vnoise`;
    return /* glsl */ `
// contour source: iso-lines of a 4-octave synthRand value-noise height field
float ${vnoise}(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  int ix = int(i.x);
  int iy = int(i.y);
  float a = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(ix), uint(iy)));
  float b = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(ix + 1), uint(iy)));
  float c = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(ix), uint(iy + 1)));
  float d = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(uint(ix + 1), uint(iy + 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float ${fnName}(vec2 p) {
  float sc = clamp(${uScale}, 0.5, 6.0);
  float lv = float(clamp(${uLevels}, 3, 20));
  float th = clamp(${uThickness}, 0.01, 0.2);
  // slow drift so the terrain breathes without ever snapping
  vec2 q = p * sc + vec2(uTime * 0.012, uTime * -0.008);
  float h = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 4; i++) {
    h += amp * ${vnoise}(q * freq + float(i) * 11.7);
    freq *= 2.03;
    amp *= 0.5;
  }
  h /= 0.9375;
  // iso-lines wherever h * levels crosses an integer
  float g = h * lv;
  float fr = fract(g);
  float d = min(fr, 1.0 - fr);
  // derivative of g is well defined even where fract() wraps
  float px = clamp(fwidth(g), 1e-5, 0.5);
  float halfW = max(th * 0.5, 1e-4);
  float w = max(halfW, px * 0.75);
  return 1.0 - smoothstep(w - px, w + px, d);
}
`.trim();
  },
};
