import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Bellows hose — folding curve with dense short cross-lines and traveling pressure bulge.
 */
export const bellowsHoseDef: GeneratorDefinition = {
  id: 'bellowsHose',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['industrial-hose'],
    affect: ['industrial', 'organic', 'odd'],
  },
  parameters: [
    {
      id: 'folds',
      label: 'Folds',
      kind: 'number',
      min: 1,
      max: 4,
      default: 2.2,
      modulatable: true,
    },
    {
      id: 'density',
      label: 'Density',
      kind: 'number',
      min: 8,
      max: 48,
      default: 24,
      modulatable: true,
    },
    {
      id: 'pressure',
      label: 'Pressure',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.5,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.55, stateful: false },
};

export const bellowsHoseGenerator: InlineGenerator = {
  def: bellowsHoseDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uFolds = uniform('folds');
    const uDensity = uniform('density');
    const uPressure = uniform('pressure');
    return /* glsl */ `
// bellowsHose source: folding spine + dense cross-ribs + traveling pressure bulge
float ${fnName}(vec2 p) {
  float folds = clamp(${uFolds}, 1.0, 4.0);
  float dens = clamp(${uDensity}, 8.0, 48.0);
  float press = clamp(${uPressure}, 0.0, 1.0);
  // large folding curve across x
  float t = p.x;
  float amp = 0.22 * folds * 0.5;
  float yCurve = sin(t * folds * 1.8) * amp + sin(t * folds * 0.55 + 1.2) * amp * 0.45;
  float dy = p.y - yCurve;
  // local compression from curvature (2nd deriv approx)
  float curv = abs(-sin(t * folds * 1.8) * folds * 1.8 * folds * 1.8) * 0.02
    + abs(-sin(t * folds * 0.55 + 1.2) * folds * 0.55 * folds * 0.55) * 0.02;
  float compress = clamp(curv * 8.0, 0.0, 1.0);
  // spine distance
  float dSpine = abs(dy);
  float halfBody = mix(0.07, 0.12, press * 0.5);
  // pressure bulge travels along path
  float along = t * 0.5 + 0.5;
  float bulgePos = fract(uTime * (0.15 + press * 0.55));
  float bulge = exp(-pow((along - bulgePos) * 6.0, 2.0)) * press;
  halfBody += bulge * 0.06;
  float halfW = max(halfBody * 0.15, 1e-4);
  float px = fwidth(dSpine);
  float w = max(halfW, px * 0.75);
  float spine = 1.0 - smoothstep(w - px, w + px, dSpine);
  // outline edges of hose body
  float dEdge = abs(dSpine - halfBody);
  float pxE = fwidth(dEdge);
  float wE = max(0.012, pxE * 0.75);
  float edge = 1.0 - smoothstep(wE - pxE, wE + pxE, dEdge);
  // dense short cross-lines (bellows ribs); denser where compressed
  float localDens = dens * (0.7 + 0.9 * compress + bulge * 0.5);
  float ribU = along * localDens;
  float ribF = abs(fract(ribU) - 0.5);
  float ribMask = 1.0 - smoothstep(0.0, halfBody * 1.05, dSpine);
  float halfRib = max(0.06, 1e-4);
  float pxR = fwidth(ribF);
  float wR = max(halfRib, pxR * 0.75);
  float ribs = (1.0 - smoothstep(wR - pxR, wR + pxR, ribF)) * ribMask;
  // brighten bulge region slightly
  float densOut = max(max(spine * 0.5, edge), ribs * (0.75 + bulge * 0.4));
  densOut = max(densOut, bulge * ribMask * 0.35);
  return clamp(densOut, 0.0, 1.0);
}
`.trim();
  },
};
