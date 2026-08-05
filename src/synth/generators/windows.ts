import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Building windows at night — rectangular grid lit/unlit by synthRand,
 * a few switching over on each timeBucket.
 */
export const windowsDef: GeneratorDefinition = {
  id: 'windows',
  version: 1,
  category: 'source',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    environment: ['urban-night'],
    affect: ['nocturnal', 'metropolitan'],
  },
  parameters: [
    {
      id: 'cols',
      label: 'Columns',
      kind: 'number',
      min: 4,
      max: 40,
      default: 14,
      modulatable: true,
    },
    {
      id: 'litRatio',
      label: 'Lit Ratio',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.45,
      modulatable: true,
    },
    {
      id: 'glow',
      label: 'Glow',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.45,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.4, stateful: false },
};

export const windowsGenerator: InlineGenerator = {
  def: windowsDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uCols = uniform('cols');
    const uLitRatio = uniform('litRatio');
    const uGlow = uniform('glow');
    return /* glsl */ `
// windows source: lit window grid; most cells are static, a few flip per timeBucket
float ${fnName}(vec2 p) {
  float cols = clamp(${uCols}, 4.0, 40.0);
  float litRatio = clamp(${uLitRatio}, 0.0, 1.0);
  float glow = clamp(${uGlow}, 0.0, 1.0);
  vec2 gp = p * cols;
  vec2 cell = floor(gp);
  vec2 f = fract(gp) - 0.5;
  uint ch = synthHashCombine(uint(int(cell.x)), uint(int(cell.y)));
  // static occupancy
  float rBase = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ch, 3u));
  float lit = step(1.0 - litRatio, rBase);
  // slow switch-over: a small share of cells invert on each bucket
  uint timeBucket = uint(floor(uTime * 0.2));
  float rNow = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ch, timeBucket));
  lit = mix(lit, 1.0 - lit, step(0.94, rNow));
  // window pane as a rounded box SDF inside the cell
  vec2 halfSize = vec2(0.3, 0.36);
  vec2 q = abs(f) - halfSize;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float px = max(fwidth(d), 1e-5);
  float pane = 1.0 - smoothstep(-px, px, d);
  // spill outside the pane
  float spill = exp(-max(d, 0.0) * mix(34.0, 9.0, glow)) * glow * 0.55;
  // slight per-window brightness spread
  float bright = 0.7 + 0.3 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ch, 8u));
  return clamp((pane * bright + spill) * lit, 0.0, 1.0);
}
`.trim();
  },
};
