import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Macroblock recompress — quantize coords to unequal rect blocks; layout rekeys over time.
 */
export const macroblockDef: GeneratorDefinition = {
  id: 'macroblock',
  version: 1,
  category: 'modifier',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    material: ['web-video'],
    affect: ['degraded', 'energetic'],
  },
  parameters: [
    {
      id: 'blockSize',
      label: 'Block Size',
      kind: 'number',
      min: 0.02,
      max: 0.3,
      default: 0.1,
      modulatable: true,
    },
    {
      id: 'keyRate',
      label: 'Key Rate',
      kind: 'number',
      min: 0.1,
      max: 2,
      default: 0.6,
      modulatable: true,
    },
    {
      id: 'mix',
      label: 'Mix',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.75,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.2, stateful: false },
};

export const macroblockGenerator: InlineGenerator = {
  def: macroblockDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uBlockSize = uniform('blockSize');
    const uKeyRate = uniform('keyRate');
    const uMix = uniform('mix');
    return /* glsl */ `
// macroblock coord-modifier: unequal rect blocks rekey via timeBucket
vec2 ${fnName}(vec2 p) {
  float bs = clamp(${uBlockSize}, 0.02, 0.3);
  float rate = clamp(${uKeyRate}, 0.1, 2.0);
  float m = clamp(${uMix}, 0.0, 1.0);
  uint timeBucket = uint(floor(uTime * rate));
  // coarse block index
  vec2 cell = floor(p / bs);
  int ix = int(cell.x);
  int iy = int(cell.y);
  uint bidx = synthHashCombine(uint(ix), uint(iy));
  bidx = synthHashCombine(bidx, timeBucket);
  // unequal size factors
  float sx = 0.55 + 0.9 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(bidx, 1u));
  float sy = 0.55 + 0.9 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(bidx, 2u));
  vec2 bsz = vec2(bs * sx, bs * sy);
  // quantize into this block's cell
  vec2 q = floor(p / bsz + 0.5) * bsz;
  // occasional block offset scramble
  float scramble = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(bidx, 3u));
  if (scramble > 0.82) {
    float ox = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(bidx, 4u)) - 0.5) * bs * 2.0;
    float oy = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(bidx, 5u)) - 0.5) * bs * 2.0;
    q += vec2(ox, oy);
  }
  return mix(p, q, m);
}
`.trim();
  },
};
