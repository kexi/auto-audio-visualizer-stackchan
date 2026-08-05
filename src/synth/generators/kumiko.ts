import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Kumiko lattice — thin orthogonal grid with optional diagonal accent lines.
 */
export const kumikoDef: GeneratorDefinition = {
  id: 'kumiko',
  version: 1,
  category: 'source',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    culturalTexture: ['japan'],
    material: ['wood-lattice'],
    affect: ['delicate'],
  },
  parameters: [
    {
      id: 'scale',
      label: 'Scale',
      kind: 'number',
      min: 2,
      max: 20,
      default: 8,
      modulatable: true,
    },
    {
      id: 'diagonal',
      label: 'Diagonal',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'thickness',
      label: 'Thickness',
      kind: 'number',
      min: 0.003,
      max: 0.04,
      default: 0.01,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.4, stateful: false },
};

export const kumikoGenerator: InlineGenerator = {
  def: kumikoDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uScale = uniform('scale');
    const uDiagonal = uniform('diagonal');
    const uThickness = uniform('thickness');
    return /* glsl */ `
// kumiko source: thin orthogonal lattice + hash-selected diagonal accents
float ${fnName}(vec2 p) {
  float sc = clamp(${uScale}, 2.0, 20.0);
  float diagAmt = clamp(${uDiagonal}, 0.0, 1.0);
  float th = clamp(${uThickness}, 0.003, 0.04);
  vec2 gp = p * sc;
  vec2 f = fract(gp);
  vec2 cell = floor(gp);
  int ix = int(cell.x);
  int iy = int(cell.y);
  // orthogonal grid lines
  float dH = min(f.y, 1.0 - f.y);
  float dV = min(f.x, 1.0 - f.x);
  float d = min(dH, dV);
  // diagonal accents on selected cells
  uint cidx = synthHashCombine(uint(ix), uint(iy));
  float pick = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 1u));
  if (pick < diagAmt) {
    float dDiag1 = abs(f.x - f.y);
    float dDiag2 = abs(f.x + f.y - 1.0);
    // alternate / and \\ based on hash
    float which = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 2u));
    if (which < 0.5) d = min(d, dDiag1);
    else d = min(d, dDiag2);
    // occasionally both for denser kumiko
    if (pick < diagAmt * 0.25) d = min(d, min(dDiag1, dDiag2));
  }
  float halfW = max(th * 0.5, 1e-4);
  float px = fwidth(d);
  float w = max(halfW, px * 0.75);
  return 1.0 - smoothstep(w - px, w + px, d);
}
`.trim();
  },
};
