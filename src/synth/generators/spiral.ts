import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Spiral (渦巻線) — Archimedean spiral bands, fwidth-AA, slowly rotating.
 */
export const spiralDef: GeneratorDefinition = {
  id: 'spiral',
  version: 1,
  category: 'source',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    motion: ['rotate'],
    affect: ['hypnotic', 'graphic'],
  },
  parameters: [
    {
      id: 'arms',
      label: 'Arms',
      kind: 'int',
      min: 1,
      max: 6,
      default: 2,
      modulatable: true,
    },
    {
      id: 'pitch',
      label: 'Pitch',
      kind: 'number',
      min: 0.05,
      max: 1,
      default: 0.22,
      modulatable: true,
    },
    {
      id: 'thickness',
      label: 'Thickness',
      kind: 'number',
      min: 0.01,
      max: 0.3,
      default: 0.05,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.4, stateful: false },
};

export const spiralGenerator: InlineGenerator = {
  def: spiralDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uArms = uniform('arms');
    const uPitch = uniform('pitch');
    const uThickness = uniform('thickness');
    return /* glsl */ `
// spiral source: Archimedean bands r = pitch * (turn + n / arms), fwidth AA
float ${fnName}(vec2 p) {
  float arms = float(clamp(${uArms}, 1, 6));
  float pitch = clamp(${uPitch}, 0.05, 1.0);
  float th = clamp(${uThickness}, 0.01, 0.3);
  float rad = length(p);
  // slow rotation; the turn count wraps by a whole number of arms so there is no seam
  float ang = atan(p.y, p.x) + uTime * 0.25;
  float turn = ang * 0.15915494309;
  float g = (rad / pitch - turn) * arms;
  float fr = fract(g);
  float d = min(fr, 1.0 - fr);
  // radial spacing between neighbouring arms in p units
  float spacing = pitch / arms;
  float halfW = clamp(th * 0.5 / spacing, 0.01, 0.49);
  float px = clamp(fwidth(g), 1e-5, 0.5);
  float w = max(halfW, px * 0.75);
  float band = 1.0 - smoothstep(w - px, w + px, d);
  // the center is a singularity — fade it out instead of aliasing
  return clamp(band * smoothstep(0.0, spacing * 1.5, rad), 0.0, 1.0);
}
`.trim();
  },
};
