import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Copy-generation degradation — B&W crush with wobbling threshold; dropouts grow then reset.
 */
export const xeroxDef: GeneratorDefinition = {
  id: 'xerox',
  version: 1,
  category: 'modifier',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    affect: ['zine', 'raw', 'underground'],
  },
  parameters: [
    {
      id: 'generations',
      label: 'Generations',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.45,
      modulatable: true,
    },
    {
      id: 'cycle',
      label: 'Cycle',
      kind: 'number',
      min: 4,
      max: 40,
      default: 12,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.25, stateful: false },
};

export const xeroxGenerator: InlineGenerator = {
  def: xeroxDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uGenerations = uniform('generations');
    const uCycle = uniform('cycle');
    return /* glsl */ `
// xerox value-modifier: multi-gen B&W crush + dropouts, periodic reset toward original
float ${fnName}(float v, vec2 p) {
  float gen = clamp(${uGenerations}, 0.0, 1.0);
  float cyc = clamp(${uCycle}, 4.0, 40.0);
  // generation envelope: degrade then hard recover toward original
  float phase = fract(uTime / cyc);
  float env = smoothstep(0.0, 0.5, phase) * (1.0 - smoothstep(0.82, 0.95, phase));
  float gAmt = gen * env;
  // wobbling threshold
  float thrWob = 0.08 * sin(uTime * 3.1 + p.x * 7.0) + 0.05 * sin(uTime * 1.7 + p.y * 5.0);
  float thr = 0.5 + thrWob * gAmt - gAmt * 0.12;
  float bw = step(thr, v);
  // soft crush mix by generation amount
  float crushed = mix(v, bw, 0.55 + 0.45 * gAmt);
  // dropouts grow with generation via timeBucket
  uint timeBucket = uint(floor(uTime * (0.6 + gen * 1.4)));
  vec2 cell = floor(p * mix(12.0, 48.0, gAmt));
  uint cidx = synthHashCombine(uint(int(cell.x)), uint(int(cell.y)));
  cidx = synthHashCombine(cidx, timeBucket);
  float dropR = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 1u));
  float dropThresh = gAmt * 0.35;
  if (dropR < dropThresh) {
    crushed = 0.0;
  }
  // occasional toner blot
  float blot = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 2u));
  if (blot > 1.0 - gAmt * 0.08) {
    crushed = mix(crushed, 1.0, 0.7);
  }
  // recover toward original late in cycle
  float recover = smoothstep(0.82, 0.95, phase);
  return mix(crushed, v, recover * (1.0 - gen * 0.35));
}
`.trim();
  },
};
