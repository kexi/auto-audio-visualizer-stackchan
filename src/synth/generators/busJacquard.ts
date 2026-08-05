import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Taiwan bus seat fabric jacquard — chevrons, diamonds, short diagonals.
 */
export const busJacquardDef: GeneratorDefinition = {
  id: 'busJacquard',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    culturalTexture: ['taiwan-streetscape'],
    affect: ['kitsch', 'nostalgic'],
    environment: ['transit'],
  },
  parameters: [
    {
      id: 'scale',
      label: 'Scale',
      kind: 'number',
      min: 4,
      max: 32,
      default: 14,
      modulatable: true,
    },
    {
      id: 'switchRate',
      label: 'Switch Rate',
      kind: 'number',
      min: 0.1,
      max: 2,
      default: 0.5,
      modulatable: true,
    },
    {
      id: 'mix',
      label: 'Mix',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.55, stateful: false },
};

export const busJacquardGenerator: InlineGenerator = {
  def: busJacquardDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uScale = uniform('scale');
    const uSwitchRate = uniform('switchRate');
    const uMix = uniform('mix');
    return /* glsl */ `
// busJacquard source: dense seat-fabric weave with phase jumps + micro reverse
float ${fnName}(vec2 p) {
  float sc = clamp(${uScale}, 4.0, 32.0);
  float rate = max(${uSwitchRate}, 0.1);
  float mx = clamp(${uMix}, 0.0, 1.0);
  uint timeBucket = uint(floor(uTime * rate));
  float phaseJump = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(timeBucket, 1u));
  float phase2 = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(timeBucket, 2u));
  // micro reverse scroll inside pattern only
  float scroll = sin(uTime * 0.55) * 0.08;
  vec2 q = p * sc;
  q.y += scroll + phaseJump * 0.5;
  q.x += phase2 * 0.35;
  vec2 fp = fract(q);
  vec2 id = floor(q);
  uint cidx = synthHashCombine(uint(int(id.x)), uint(int(id.y)));
  float motif = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 3u));
  float dens = 0.0;
  // chevron
  float ch = abs(fp.x - 0.5) + abs(fp.y - 0.5);
  float dCh = abs(ch - 0.45);
  // diamond
  float dia = abs(fp.x - 0.5) + abs(fp.y - 0.5);
  float dDia = abs(dia - 0.35);
  // short diagonal
  float diag = abs(fp.x - fp.y);
  float dDiag = min(diag, abs(fp.x + fp.y - 1.0));
  float d = dCh;
  if (motif < 0.33) d = dCh;
  else if (motif < 0.66) d = dDia;
  else d = dDiag;
  // blend motifs by mix
  d = mix(d, min(min(dCh, dDia), dDiag), mx * 0.65);
  float halfW = max(0.06, 1e-4);
  float px = fwidth(d);
  float w = max(halfW, px * 0.75);
  dens = 1.0 - smoothstep(w - px, w + px, d);
  // secondary weave grid
  vec2 g = abs(fp - 0.5);
  float gridD = min(g.x, g.y);
  float pxG = fwidth(gridD);
  float wG = max(0.02, pxG * 0.75);
  float grid = (1.0 - smoothstep(wG - pxG, wG + pxG, gridD)) * 0.35 * mx;
  dens = max(dens, grid);
  return clamp(dens, 0.0, 1.0);
}
`.trim();
  },
};
