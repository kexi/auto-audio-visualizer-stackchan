import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Tile facade source — brick stagger + grout lines (density on joints).
 */
export const tilesDef: GeneratorDefinition = {
  id: 'tiles',
  version: 1,
  category: 'source',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    environment: ['urban'],
    material: ['tile'],
    affect: ['nostalgic'],
  },
  parameters: [
    {
      id: 'scale',
      label: 'Scale',
      kind: 'number',
      min: 2,
      max: 40,
      default: 8,
      modulatable: true,
    },
    {
      id: 'gap',
      label: 'Gap',
      kind: 'number',
      min: 0.01,
      max: 0.3,
      default: 0.06,
      modulatable: true,
    },
    {
      id: 'stagger',
      label: 'Stagger',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.5,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.35, stateful: false },
};

export const tilesGenerator: InlineGenerator = {
  def: tilesDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uScale = uniform('scale');
    const uGap = uniform('gap');
    const uStagger = uniform('stagger');
    return /* glsl */ `
// tiles source: brick stagger + grout density on joints
float ${fnName}(vec2 p) {
  float sc = max(${uScale}, 1.0);
  float gap = clamp(${uGap}, 0.01, 0.3);
  float st = clamp(${uStagger}, 0.0, 1.0);
  vec2 gp = p * sc;
  float row = floor(gp.y);
  gp.x += mod(row, 2.0) * 0.5 * st;
  vec2 fp = fract(gp);
  vec2 d = min(fp, 1.0 - fp);
  float md = min(d.x, d.y);
  float halfW = max(gap * 0.5, 1e-4);
  float px = fwidth(md);
  float w = max(halfW, px * 0.75);
  return 1.0 - smoothstep(w - px, w + px, md);
}
`.trim();
  },
};
