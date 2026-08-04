import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Branching line field without recursion — iterative fold + rotate
 * (classic multi-scale branch SDF approximation). Fixed loop bound 6 with early break on depth.
 */
export const branchDef: GeneratorDefinition = {
  id: 'branch',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['organic', 'line'],
    environment: ['dendritic', 'botanical'],
    affect: ['growth', 'structured'],
  },
  parameters: [
    {
      id: 'depth',
      label: 'Depth',
      kind: 'int',
      min: 1,
      max: 6,
      default: 4,
      modulatable: true,
    },
    {
      id: 'angle',
      label: 'Angle',
      kind: 'number',
      min: 0,
      max: 1.5,
      default: 0.6,
      modulatable: true,
    },
    {
      id: 'thickness',
      label: 'Thickness',
      kind: 'number',
      min: 0.001,
      max: 0.2,
      default: 0.02,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.7, stateful: false },
};

export const branchGenerator: InlineGenerator = {
  def: branchDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uDepth = uniform('depth');
    const uAngle = uniform('angle');
    const uThickness = uniform('thickness');
    return /* glsl */ `
// branch source: iterative fold+rotate line segments (no recursion)
float ${fnName}(vec2 p) {
  int dep = clamp(${uDepth}, 1, 6);
  float ang = clamp(${uAngle}, 0.0, 1.5);
  float th = max(${uThickness}, 0.001);
  vec2 q = p;
  float w = th;
  float d = 1e5;
  for (int i = 0; i < 6; i++) {
    if (i >= dep) break;
    // segment along +x from 0..0.45, thickness w
    float sx = clamp(q.x, 0.0, 0.45);
    float seg = length(q - vec2(sx, 0.0)) - w;
    d = min(d, seg);
    // fold + rotate for next level
    q = abs(q);
    float ca = cos(ang);
    float sa = sin(ang);
    q = mat2(ca, -sa, sa, ca) * q;
    q.x -= 0.45;
    w *= 0.72;
  }
  // Resolution-independent AA: soft falloff stays ≥ ~0.75px so thin twigs survive low res.
  float md = max(d, 0.0);
  float px = fwidth(d);
  float soft = max(th * 2.0, 1e-4);
  float edgeW = max(soft, px * 0.75);
  return 1.0 - smoothstep(edgeW - px, edgeW + px, md);
}
`.trim();
  },
};
