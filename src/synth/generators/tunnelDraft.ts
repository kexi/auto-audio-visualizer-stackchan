import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Tunnel suction field — nonlinear compress toward receding point, then escape sideways.
 * Assembler multiplies return value by amount.
 */
export const tunnelDraftDef: GeneratorDefinition = {
  id: 'tunnelDraft',
  version: 1,
  category: 'field',
  costClass: 'light',
  impl: 'inline',
  output: 'vector',
  tags: {
    affect: ['subterranean', 'propulsive', 'eerie'],
  },
  parameters: [
    {
      id: 'pull',
      label: 'Pull',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'escape',
      label: 'Escape',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.5,
      modulatable: true,
    },
    {
      id: 'amount',
      label: 'Amount',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.2,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.3, stateful: false },
};

export const tunnelDraftGenerator: InlineGenerator = {
  def: tunnelDraftDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uPull = uniform('pull');
    const uEscape = uniform('escape');
    return /* glsl */ `
// tunnelDraft field: suction toward receding point + sideways escape (amount in main)
vec2 ${fnName}(vec2 p) {
  float pull = clamp(${uPull}, 0.0, 1.0);
  float esc = clamp(${uEscape}, 0.0, 1.0);
  // suction point recedes forever along +y (and slight x drift)
  float recede = uTime * 0.08;
  vec2 c = vec2(sin(uTime * 0.05) * 0.15, -0.2 + recede * 0.15 + sin(uTime * 0.03) * 0.1);
  // keep center notionally "ahead" by wrapping feel via slow offset
  c.y = mod(c.y + 1.5, 3.0) - 1.5;
  vec2 d = c - p;
  float r = length(d);
  vec2 dir = d / max(r, 1e-4);
  // nonlinear falloff: strong mid-range, soft far, never fully collapses near center
  float fall = pull * (r / (r * r + 0.08));
  fall = min(fall, 1.2);
  // near center: rotate/escape sideways so flow never reaches the point
  float near = exp(-r * r * 12.0);
  vec2 side = vec2(-dir.y, dir.x);
  // alternate escape handedness slowly
  float hand = sign(sin(uTime * 0.2 + p.x * 2.0));
  if (hand == 0.0) hand = 1.0;
  vec2 pullV = dir * fall * (1.0 - near * 0.95);
  vec2 escV = side * hand * near * esc * 1.4;
  // slight forward tunnel component
  pullV.y += pull * 0.08 * (1.0 - near);
  return pullV + escV;
}
`.trim();
  },
};
