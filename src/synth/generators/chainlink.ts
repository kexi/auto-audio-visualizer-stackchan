import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Chain-link fence — woven diamond mesh from two kinked line families, fwidth-AA.
 */
export const chainlinkDef: GeneratorDefinition = {
  id: 'chainlink',
  version: 1,
  category: 'source',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['galvanized-wire'],
    environment: ['urban'],
    affect: ['provisional', 'restrained'],
  },
  parameters: [
    {
      id: 'scale',
      label: 'Scale',
      kind: 'number',
      min: 4,
      max: 32,
      default: 12,
      modulatable: true,
    },
    {
      id: 'thickness',
      label: 'Thickness',
      kind: 'number',
      min: 0.004,
      max: 0.06,
      default: 0.014,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.4, stateful: false },
};

export const chainlinkGenerator: InlineGenerator = {
  def: chainlinkDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uScale = uniform('scale');
    const uThickness = uniform('thickness');
    return /* glsl */ `
// chainlink source: two 45-degree wire families with a woven kink, fwidth AA
float ${fnName}(vec2 p) {
  float sc = clamp(${uScale}, 4.0, 32.0);
  float th = clamp(${uThickness}, 0.004, 0.06);
  vec2 gp = p * sc;
  // rotate into the diamond frame
  float u = (gp.x + gp.y) * 0.70710678119;
  float v = (gp.x - gp.y) * 0.70710678119;
  // each wire zigzags slightly across its neighbour — the woven look
  float au = u + 0.09 * sin(v * 6.28318530718);
  float av = v + 0.09 * sin(u * 6.28318530718);
  float fu = fract(au);
  float fv = fract(av);
  float du = min(fu, 1.0 - fu);
  float dv = min(fv, 1.0 - fv);
  float halfW = max(th * sc * 0.70710678119, 1e-4);
  float pu = clamp(fwidth(au), 1e-5, 0.5);
  float pv = clamp(fwidth(av), 1e-5, 0.5);
  float wu = max(halfW, pu * 0.75);
  float wv = max(halfW, pv * 0.75);
  float lineU = 1.0 - smoothstep(wu - pu, wu + pu, du);
  float lineV = 1.0 - smoothstep(wv - pv, wv + pv, dv);
  return clamp(max(lineU, lineV), 0.0, 1.0);
}
`.trim();
  },
};
