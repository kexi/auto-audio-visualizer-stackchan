import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * PCB maze — manhattan right-angle thin traces + circular pads; regions grow/fade.
 */
export const pcbMazeDef: GeneratorDefinition = {
  id: 'pcbMaze',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['circuit'],
    affect: ['retro-tech', 'playful', 'cerebral'],
  },
  parameters: [
    {
      id: 'scale',
      label: 'Scale',
      kind: 'number',
      min: 4,
      max: 40,
      default: 16,
      modulatable: true,
    },
    {
      id: 'pads',
      label: 'Pads',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'growth',
      label: 'Growth',
      kind: 'number',
      min: 0,
      max: 2,
      default: 0.6,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.55, stateful: false },
};

export const pcbMazeGenerator: InlineGenerator = {
  def: pcbMazeDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uScale = uniform('scale');
    const uPads = uniform('pads');
    const uGrowth = uniform('growth');
    return /* glsl */ `
// pcbMaze source: manhattan thin traces + pads; region swap-in/out via timeBucket
float ${fnName}(vec2 p) {
  float sc = clamp(${uScale}, 4.0, 40.0);
  float padAmt = clamp(${uPads}, 0.0, 1.0);
  float grow = clamp(${uGrowth}, 0.0, 2.0);
  vec2 gp = p * sc;
  vec2 cell = floor(gp);
  vec2 f = fract(gp);
  int ix = int(cell.x);
  int iy = int(cell.y);
  uint cidx = synthHashCombine(uint(ix), uint(iy));
  // region live mask evolves with growth rate
  uint timeBucket = uint(floor(uTime * max(grow, 0.05) * 0.35));
  // coarse region id so whole neighborhoods swap together
  int rx = ix / 4;
  int ry = iy / 4;
  uint ridx = synthHashCombine(uint(rx), uint(ry));
  float live = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ridx, timeBucket));
  float regionOn = step(0.35, live);
  // fade edge between buckets for soft grow/die
  float fade = fract(uTime * max(grow, 0.05) * 0.35);
  float nextLive = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(ridx, timeBucket + 1u));
  float regionNext = step(0.35, nextLive);
  float region = mix(regionOn, regionNext, smoothstep(0.75, 1.0, fade));
  // routing mode per cell: H-then-V, V-then-H, dead-end H, dead-end V, empty
  float modeR = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 1u));
  float d = 1e5;
  // horizontal edge along bottom of cell (to right neighbor)
  float hOn = step(modeR, 0.72);
  float vOn = step(0.22, modeR) * step(modeR, 0.88);
  // dead-end: only partial segment
  float dead = step(0.72, modeR) * step(modeR, 0.92);
  float hLen = mix(1.0, 0.35 + 0.45 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 2u)), dead);
  float vLen = mix(1.0, 0.35 + 0.45 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 3u)), dead);
  // manhattan L: H then V or V then H
  float hTrace = abs(f.y - 0.0);
  if (f.x > hLen) hTrace = 1e5;
  float vTrace = abs(f.x - 0.0);
  if (f.y > vLen) vTrace = 1e5;
  // also mid-cell corner route for awkward detours
  float midH = abs(f.y - 0.5);
  float midV = abs(f.x - 0.5);
  float corner = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 4u));
  if (hOn > 0.5) {
    d = min(d, hTrace);
    if (corner > 0.55) d = min(d, midH + step(0.55, f.x) * 1e5);
  }
  if (vOn > 0.5) {
    d = min(d, vTrace);
    if (corner < 0.45) d = min(d, midV + step(0.55, f.y) * 1e5);
  }
  // neighbor continuity: top and right cell edges shared
  float nTop = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(synthHashCombine(uint(ix), uint(iy + 1)), 1u));
  if (nTop < 0.72) d = min(d, abs(f.y - 1.0));
  float nRight = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(synthHashCombine(uint(ix + 1), uint(iy)), 1u));
  if (nRight > 0.22 && nRight < 0.88) d = min(d, abs(f.x - 1.0));
  float halfW = max(0.045, 1e-4);
  float px = fwidth(d);
  float w = max(halfW, px * 0.75);
  float trace = 1.0 - smoothstep(w - px, w + px, d);
  // circular pads at cell corners / endpoints
  float padR = 0.12 + 0.06 * padAmt;
  float dPad = 1e5;
  if (padAmt > 0.05) {
    float p0 = length(f - vec2(0.0, 0.0));
    float p1 = length(f - vec2(1.0, 0.0));
    float p2 = length(f - vec2(0.0, 1.0));
    float p3 = length(f - vec2(0.5, 0.5));
    float padPick = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 5u));
    if (padPick < 0.25 + padAmt * 0.5) dPad = min(dPad, abs(p0 - padR * 0.35));
    if (padPick > 0.35) dPad = min(dPad, p0); // filled pad
    if (padPick > 0.55) dPad = min(dPad, p1);
    if (padPick > 0.7 && corner > 0.5) dPad = min(dPad, p3);
    float ring = abs(p2 - padR * 0.5);
    if (padPick > 0.4) dPad = min(dPad, ring);
  }
  float pxP = fwidth(dPad);
  float wP = max(padR * 0.35 * padAmt + 0.02, pxP * 0.75);
  float pad = (1.0 - smoothstep(wP - pxP, wP + pxP, dPad)) * padAmt;
  float dens = max(trace, pad) * region;
  return clamp(dens, 0.0, 1.0);
}
`.trim();
  },
};
