import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Under-viaduct panel joints — large rect panels, thin dark joints, repair lines.
 */
export const viaductJointsDef: GeneratorDefinition = {
  id: 'viaductJoints',
  version: 1,
  category: 'source',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  tags: {
    environment: ['urban'],
    affect: ['brutalist', 'quiet', 'metropolitan'],
  },
  parameters: [
    {
      id: 'panelScale',
      label: 'Panel Scale',
      kind: 'number',
      min: 1,
      max: 8,
      default: 3,
      modulatable: true,
    },
    {
      id: 'repair',
      label: 'Repair',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.4,
      modulatable: true,
    },
    {
      id: 'drift',
      label: 'Drift',
      kind: 'number',
      min: 0,
      max: 0.2,
      default: 0.05,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.4, stateful: false },
};

export const viaductJointsGenerator: InlineGenerator = {
  def: viaductJointsDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uPanelScale = uniform('panelScale');
    const uRepair = uniform('repair');
    const uDrift = uniform('drift');
    return /* glsl */ `
// viaductJoints source: large panels split by thin joints + repair marks
float ${fnName}(vec2 p) {
  float sc = clamp(${uPanelScale}, 1.0, 8.0);
  float rep = clamp(${uRepair}, 0.0, 1.0);
  float dr = clamp(${uDrift}, 0.0, 0.2);
  // ultra-slow horizontal drift
  vec2 q = p;
  q.x += uTime * dr * 0.15;
  // uneven spacing via per-cell scale jitter
  float cell = sc * 0.85;
  vec2 gp = q * cell;
  vec2 id = floor(gp);
  uint cidx = synthHashCombine(uint(int(id.x)), uint(int(id.y)));
  float jx = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 1u)) - 0.5) * 0.25;
  float jy = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 2u)) - 0.5) * 0.2;
  vec2 fp = fract(gp) - vec2(jx, jy) * 0.15;
  // slight step near joints (panel height offset)
  float stepY = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 3u)) - 0.5) * 0.04;
  fp.y += stepY;
  vec2 dEdge = min(fp, 1.0 - fp);
  float md = min(dEdge.x, dEdge.y);
  float halfW = max(0.012, 1e-4);
  float px = fwidth(md);
  float w = max(halfW, px * 0.75);
  float joint = 1.0 - smoothstep(w - px, w + px, md);
  // short repair lines
  float dens = joint;
  float rRoll = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 4u));
  if (rRoll < rep * 0.7) {
    float ang = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 5u)) * 3.14159265;
    float ca = cos(ang);
    float sa = sin(ang);
    vec2 lp = fp - 0.5;
    float along = lp.x * ca + lp.y * sa;
    float perp = abs(-lp.x * sa + lp.y * ca);
    float seg = step(abs(along), 0.18 + 0.15 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 6u)));
    float halfR = max(0.008, 1e-4);
    float pxR = fwidth(perp);
    float wR = max(halfR, pxR * 0.75);
    float repairLine = (1.0 - smoothstep(wR - pxR, wR + pxR, perp)) * seg * rep;
    dens = max(dens, repairLine);
  }
  // local density blotches
  float blot = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cidx, 7u));
  dens = max(dens, step(0.88, blot) * 0.15 * rep);
  return clamp(dens, 0.0, 1.0);
}
`.trim();
  },
};
