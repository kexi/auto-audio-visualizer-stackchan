import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Highway shoulder dashed lines + reflective dots flowing toward camera.
 */
export const roadStitchDef: GeneratorDefinition = {
  id: 'roadStitch',
  version: 1,
  category: 'source',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    affect: ['travelling', 'meditative', 'persistent'],
    environment: ['road'],
  },
  parameters: [
    {
      id: 'lanes',
      label: 'Lanes',
      kind: 'int',
      min: 1,
      max: 5,
      default: 2,
      modulatable: true,
    },
    {
      id: 'speed',
      label: 'Speed',
      kind: 'number',
      min: 0,
      max: 3,
      default: 1.2,
      modulatable: true,
    },
    {
      id: 'breakup',
      label: 'Breakup',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.35,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.4, stateful: false },
};

export const roadStitchGenerator: InlineGenerator = {
  def: roadStitchDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uLanes = uniform('lanes');
    const uSpeed = uniform('speed');
    const uBreakup = uniform('breakup');
    return /* glsl */ `
// roadStitch source: perspective dashed shoulder lines + reflective dots
float ${fnName}(vec2 p) {
  int lanes = clamp(${uLanes}, 1, 5);
  float spd = max(${uSpeed}, 0.0);
  float brk = clamp(${uBreakup}, 0.0, 1.0);
  // speed breathes slowly
  float breath = 0.85 + 0.15 * sin(uTime * 0.22);
  float flow = uTime * spd * breath;
  // depth from y: near bottom (y~-1) = close, top = far
  float depth = clamp(1.0 - (p.y * 0.5 + 0.5), 0.05, 1.0);
  float persp = mix(0.15, 1.0, depth);
  float dens = 0.0;
  for (int li = 0; li < 5; li++) {
    if (li >= lanes) break;
    uint lidx = uint(li);
    // lane x offset spreads with proximity
    float side = (float(li) + 0.5) / float(lanes) - 0.5;
    float laneX = side * 1.1 * persp;
    float dx = abs(p.x - laneX);
    // dashed pattern along depth (y) with scroll
    float pitch = mix(18.0, 4.0, depth);
    float along = (-p.y + flow * 0.35) * pitch;
    float cell = floor(along);
    float f = fract(along);
    uint cidx = synthHashCombine(lidx, uint(int(cell)));
    float dashLen = 0.35 + 0.25 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 1u));
    float gapJit = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 2u));
    // irregular gap / missing dash via breakup
    float miss = step(1.0 - brk * 0.55, gapJit);
    float onDash = step(f, dashLen) * (1.0 - miss);
    float halfW = max(0.008 * persp, 1e-4);
    float px = fwidth(dx);
    float w = max(halfW, px * 0.75);
    float line = (1.0 - smoothstep(w - px, w + px, dx)) * onDash;
    dens = max(dens, line);
    // reflective dots along dashes
    float dotPhase = fract(along * 0.5 + synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 3u)));
    float dDot = length(vec2((p.x - laneX) / max(persp, 1e-4), (dotPhase - 0.5) * 0.08));
    float dpx = fwidth(dDot);
    float dw = max(0.006 * persp, dpx * 0.75);
    float dot = (1.0 - smoothstep(dw - dpx, dw + dpx, dDot)) * onDash * 0.9;
    dens = max(dens, dot);
  }
  return clamp(dens, 0.0, 1.0);
}
`.trim();
  },
};
