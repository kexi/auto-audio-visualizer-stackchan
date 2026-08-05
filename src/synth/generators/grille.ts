import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Iron window grille — kaleido fold + random radial spokes and arcs.
 */
export const grilleDef: GeneratorDefinition = {
  id: 'grille',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    culturalTexture: ['sinosphere', 'taiwan-streetscape'],
    material: ['iron'],
    affect: ['nostalgic'],
  },
  parameters: [
    {
      id: 'folds',
      label: 'Folds',
      kind: 'int',
      min: 2,
      max: 12,
      default: 6,
      modulatable: true,
    },
    {
      id: 'density',
      label: 'Density',
      kind: 'int',
      min: 1,
      max: 8,
      default: 3,
      modulatable: true,
    },
    {
      id: 'thickness',
      label: 'Thickness',
      kind: 'number',
      min: 0.004,
      max: 0.06,
      default: 0.012,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.65, stateful: false },
};

export const grilleGenerator: InlineGenerator = {
  def: grilleDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uFolds = uniform('folds');
    const uDensity = uniform('density');
    const uThickness = uniform('thickness');
    return /* glsl */ `
// grille source: kaleido iron bars (spokes + arcs) with fwidth AA
float ${fnName}(vec2 p) {
  int folds = clamp(${uFolds}, 2, 12);
  int dens = clamp(${uDensity}, 1, 8);
  float th = max(${uThickness}, 0.004);
  float TAU = 6.28318530718;
  float ang = atan(p.y, p.x);
  float r = length(p);
  float sector = TAU / float(folds);
  float a = abs(mod(ang, sector * 2.0) - sector);
  // folded polar coords (wedge [0, sector])
  float d = 1e5;
  for (int i = 0; i < 8; i++) {
    if (i >= dens) break;
    uint idx = uint(i);
    // radial spoke at random angle in wedge
    float aSpoke = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 0u)) * sector;
    float dSpoke = abs(a - aSpoke) * max(r, 1e-4);
    d = min(d, dSpoke);
    // circular arc at random radius
    float rArc = 0.08 + synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 1u)) * 0.75;
    float dArc = abs(r - rArc);
    d = min(d, dArc);
  }
  // center hub ring
  d = min(d, abs(r - 0.04));
  float halfW = max(th * 0.5, 1e-4);
  float px = fwidth(d);
  float w = max(halfW, px * 0.75);
  return 1.0 - smoothstep(w - px, w + px, d);
}
`.trim();
  },
};
