import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Save corruption — small cell remaps/flips; corruption grows then full recover cycles.
 */
export const corruptSaveDef: GeneratorDefinition = {
  id: 'corruptSave',
  version: 1,
  category: 'modifier',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    affect: ['game-like', 'eerie', 'playful'],
  },
  parameters: [
    {
      id: 'cellScale',
      label: 'Cell Scale',
      kind: 'number',
      min: 4,
      max: 40,
      default: 16,
      modulatable: true,
    },
    {
      id: 'corruption',
      label: 'Corruption',
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
      min: 2,
      max: 30,
      default: 10,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.25, stateful: false },
};

export const corruptSaveGenerator: InlineGenerator = {
  def: corruptSaveDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uCellScale = uniform('cellScale');
    const uCorruption = uniform('corruption');
    const uCycle = uniform('cycle');
    return /* glsl */ `
// corruptSave coord-modifier: cell remap/flip grows then recover cycles
vec2 ${fnName}(vec2 p) {
  float sc = clamp(${uCellScale}, 4.0, 40.0);
  float corr = clamp(${uCorruption}, 0.0, 1.0);
  float cyc = clamp(${uCycle}, 2.0, 30.0);
  // corruption envelope: grow then hard recover
  float phase = fract(uTime / cyc);
  float env = smoothstep(0.0, 0.55, phase) * (1.0 - smoothstep(0.85, 0.95, phase));
  float thresh = corr * env;
  vec2 cell = floor(p * sc);
  int ix = int(cell.x);
  int iy = int(cell.y);
  uint cidx = synthHashCombine(uint(ix), uint(iy));
  float r = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 1u));
  if (r > thresh) {
    return p;
  }
  // remap / flip modes
  float mode = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 2u));
  vec2 f = fract(p * sc);
  vec2 outP = p;
  if (mode < 0.33) {
    // flip x inside cell
    f.x = 1.0 - f.x;
    outP = (cell + f) / sc;
  } else if (mode < 0.66) {
    // flip y
    f.y = 1.0 - f.y;
    outP = (cell + f) / sc;
  } else {
    // remap to another cell
    float ox = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 3u)) * 2.0 - 1.0;
    float oy = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 4u)) * 2.0 - 1.0;
    vec2 other = cell + vec2(floor(ox * 3.0), floor(oy * 3.0));
    outP = (other + f) / sc;
  }
  return outP;
}
`.trim();
  },
};
