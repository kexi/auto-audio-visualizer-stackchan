import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Temple ornament zigzag bands — stacked sawtooth layers drifting opposite ways.
 */
export const templeZigzagDef: GeneratorDefinition = {
  id: 'templeZigzag',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    culturalTexture: ['sinosphere'],
    affect: ['festive', 'ornate', 'electric'],
  },
  parameters: [
    {
      id: 'layers',
      label: 'Layers',
      kind: 'int',
      min: 2,
      max: 6,
      default: 4,
      modulatable: true,
    },
    {
      id: 'teeth',
      label: 'Teeth',
      kind: 'number',
      min: 4,
      max: 40,
      default: 16,
      modulatable: true,
    },
    {
      id: 'speed',
      label: 'Speed',
      kind: 'number',
      min: 0,
      max: 2,
      default: 0.4,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.5, stateful: false },
};

export const templeZigzagGenerator: InlineGenerator = {
  def: templeZigzagDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uLayers = uniform('layers');
    const uTeeth = uniform('teeth');
    const uSpeed = uniform('speed');
    return /* glsl */ `
// templeZigzag source: stacked sawtooth ornament bands, no center bias
float ${fnName}(vec2 p) {
  int nLay = clamp(${uLayers}, 2, 6);
  float teeth = clamp(${uTeeth}, 4.0, 40.0);
  float spd = max(${uSpeed}, 0.0);
  float dens = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= nLay) break;
    uint idx = uint(i);
    float dir = (i % 2 == 0) ? 1.0 : -1.0;
    float yBase = mix(-0.85, 0.85, (float(i) + 0.5) / float(nLay));
    float period = teeth * (0.7 + 0.6 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 1u)));
    float amp = 0.04 + 0.05 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 2u));
    float drift = uTime * spd * 0.15 * dir * (0.6 + 0.8 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 3u)));
    float x = p.x + drift;
    // sawtooth wave
    float cell = fract(x * period * 0.5 + 0.5);
    float saw = (cell < 0.5) ? (cell * 2.0) : (2.0 - cell * 2.0);
    if (dir < 0.0) saw = 1.0 - saw;
    float yWave = yBase + (saw - 0.5) * 2.0 * amp;
    float d = abs(p.y - yWave);
    float halfW = max(0.012, 1e-4);
    float px = fwidth(d);
    float w = max(halfW, px * 0.75);
    float band = 1.0 - smoothstep(w - px, w + px, d);
    dens = max(dens, band);
    // secondary thinner tooth outline
    float d2 = abs(p.y - (yWave + amp * 0.35 * dir));
    float px2 = fwidth(d2);
    float w2 = max(0.006, px2 * 0.75);
    dens = max(dens, (1.0 - smoothstep(w2 - px2, w2 + px2, d2)) * 0.55);
  }
  return clamp(dens, 0.0, 1.0);
}
`.trim();
  },
};
