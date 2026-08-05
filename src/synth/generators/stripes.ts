import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Angled parallel stripe bands.
 */
export const stripesDef: GeneratorDefinition = {
  id: 'stripes',
  version: 1,
  category: 'source',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['stripe', 'graphic'],
    motion: ['static'],
    affect: ['graphic'],
  },
  parameters: [
    {
      id: 'count',
      label: 'Count',
      kind: 'number',
      min: 2,
      max: 64,
      default: 12,
      modulatable: true,
    },
    {
      id: 'duty',
      label: 'Duty',
      kind: 'number',
      min: 0.05,
      max: 0.95,
      default: 0.45,
      modulatable: true,
    },
    {
      id: 'angle',
      label: 'Angle',
      kind: 'number',
      min: 0,
      max: 180,
      default: 30,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.25, stateful: false },
};

export const stripesGenerator: InlineGenerator = {
  def: stripesDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uCount = uniform('count');
    const uDuty = uniform('duty');
    const uAngle = uniform('angle');
    return /* glsl */ `
// stripes source: angled parallel bands with soft duty edges
float ${fnName}(vec2 p) {
  float cnt = max(${uCount}, 2.0);
  float duty = clamp(${uDuty}, 0.05, 0.95);
  float rad = ${uAngle} * 0.017453292519943295;
  float ca = cos(rad);
  float sa = sin(rad);
  vec2 q = mat2(ca, -sa, sa, ca) * p;
  float band = fract(q.x * cnt);
  float px = fwidth(band);
  float halfW = duty * 0.5;
  // distance from band center (0.5) within unit cell
  float md = abs(band - 0.5);
  float w = max(halfW, px * 0.75);
  return 1.0 - smoothstep(w - px, w + px, md);
}
`.trim();
  },
};
