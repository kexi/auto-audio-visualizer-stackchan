import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Glitch horizontal band shifts, time-quantized via synthRand.
 */
export const sliceDef: GeneratorDefinition = {
  id: 'slice',
  version: 1,
  category: 'modifier',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    material: ['compression-noise'],
    motion: ['glitch'],
    affect: ['eerie'],
  },
  parameters: [
    {
      id: 'bands',
      label: 'Bands',
      kind: 'int',
      min: 2,
      max: 32,
      default: 8,
      modulatable: true,
    },
    {
      id: 'shift',
      label: 'Shift',
      kind: 'number',
      min: 0,
      max: 0.5,
      default: 0.12,
      modulatable: true,
    },
    {
      id: 'rate',
      label: 'Rate',
      kind: 'number',
      min: 0.5,
      max: 8,
      default: 2,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.15, stateful: false },
};

export const sliceGenerator: InlineGenerator = {
  def: sliceDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uBands = uniform('bands');
    const uShift = uniform('shift');
    const uRate = uniform('rate');
    return /* glsl */ `
// slice coord-modifier: time-quantized horizontal band glitch shifts
vec2 ${fnName}(vec2 p) {
  int bands = clamp(${uBands}, 2, 32);
  float sh = clamp(${uShift}, 0.0, 0.5);
  float rate = max(${uRate}, 0.5);
  float bandF = floor((p.y + 0.5) * float(bands));
  uint timeBucket = uint(floor(uTime * rate));
  uint idx = synthHashCombine(uint(int(bandF)), timeBucket);
  float r = synthRand(${seedUniform}, ${nsUniform}, idx);
  float dx = (r - 0.5) * 2.0 * sh;
  p.x += dx;
  return p;
}
`.trim();
  },
};
