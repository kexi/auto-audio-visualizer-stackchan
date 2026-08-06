import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Steel truss lattice — raymarched 3D, the girders under a flyover as a space.
 *
 * Source なので返り値は 0..1 の density。march は定数上限 + break（M1 Air 保護）。
 */
export const sdfLatticeDef: GeneratorDefinition = {
  id: 'sdfLattice',
  version: 1,
  category: 'source',
  costClass: 'heavy',
  impl: 'inline',
  output: 'field',
  tags: {
    environment: ['urban'],
    material: ['steel', 'galvanized'],
    motion: ['drift'],
    affect: ['infrastructural', 'heavy', 'dense', 'industrial'],
  },
  parameters: [
    {
      id: 'cell',
      label: 'Cell',
      kind: 'number',
      min: 0.35,
      max: 1.3,
      default: 0.72,
      modulatable: true,
    },
    {
      id: 'thickness',
      label: 'Thickness',
      kind: 'number',
      min: 0.02,
      max: 0.12,
      default: 0.05,
      modulatable: true,
    },
    {
      id: 'brace',
      label: 'Brace',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'speed',
      label: 'Speed',
      kind: 'number',
      min: 0,
      max: 2,
      default: 0.7,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 1.1, stateful: false },
};

export const sdfLatticeGenerator: InlineGenerator = {
  def: sdfLatticeDef,
  preludes: ['sdf3d'],
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uCell = uniform('cell');
    const uThickness = uniform('thickness');
    const uBrace = uniform('brace');
    const uSpeed = uniform('speed');
    const map = `${fnName}_map`;
    const nrm = `${fnName}_nrm`;
    /** synthRand shorthand: index is hashCombine(idx, k). */
    const r = (idx: string, k: string) =>
      `synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(${idx}, ${k}))`;
    return /* glsl */ `
// sdfLattice source: raymarched steel truss — three rod axes + diagonal braces,
// repeated infinitely with op3Rep. The camera drifts along the cell-corner
// channel, which is the only collision-free path through the lattice.
float ${map}(vec3 pos) {
  float cell = clamp(${uCell}, 0.35, 1.3);
  // radius can never reach the half cell, or the camera would start inside steel
  float rad = min(max(${uThickness}, 0.01), cell * 0.2);
  vec3 q = op3Rep(pos, vec3(cell));
  // one infinite rod per axis, through every cell centre
  float d = min(length(q.yz), min(length(q.xz), length(q.xy))) - rad;
  // Diagonal braces through the cell centre. Directions are xz / yz on purpose:
  // an xy brace would run straight down the corner channel the camera flies in.
  // The radius folds negative when brace is off, so the marcher never creeps
  // along a zero-thickness line.
  float braceR = rad * (0.85 * clamp(${uBrace}, 0.0, 1.0)) - 0.02;
  vec3 d1 = vec3(0.70710678, 0.0, 0.70710678);
  vec3 d2 = vec3(0.0, 0.70710678, 0.70710678);
  d = min(d, length(q - d1 * dot(q, d1)) - braceR);
  d = min(d, length(q - d2 * dot(q, d2)) - braceR);
  return d;
}

vec3 ${nrm}(vec3 pos) {
  vec2 e = vec2(1.0, -1.0) * 0.0022;
  return normalize(
    e.xyy * ${map}(pos + e.xyy) + e.yyx * ${map}(pos + e.yyx) +
    e.yxy * ${map}(pos + e.yxy) + e.xxx * ${map}(pos + e.xxx));
}

float ${fnName}(vec2 p) {
  float cell = clamp(${uCell}, 0.35, 1.3);
  float spd = clamp(${uSpeed}, 0.0, 2.0);
  float tt = uTime * spd;
  float ph0 = ${r('0u', '1u')} * 6.28318530718;
  float ph1 = ${r('0u', '2u')} * 6.28318530718;
  float ph2 = ${r('0u', '3u')} * 6.28318530718;
  float ph3 = ${r('0u', '4u')} * 6.28318530718;
  // Half-cell offset puts the path on the corner channel — the one line through
  // the lattice that clears every rod and brace. The wobble is capped at 0.2 cell
  // so the camera keeps at least 0.1 cell of air around it at any thickness.
  vec3 ro = vec3(cell * 0.5) + vec3(
    sin(tt * 0.21 + ph0) * cell * 0.2,
    sin(tt * 0.17 + ph1) * cell * 0.2,
    tt * 0.55);
  vec3 rd = normalize(vec3(p, 0.9));
  rd.yz = rot2(rd.yz, 0.2 * sin(tt * 0.13 + ph2));
  rd.xz = rot2(rd.xz, 0.24 * sin(tt * 0.11 + ph3));

  const int MAX_STEPS = 60;
  const float MAX_T = 11.0;
  float t = 0.02;
  float d = 0.0;
  int hitStep = -1;
  for (int i = 0; i < MAX_STEPS; i++) {
    d = ${map}(ro + rd * t);
    if (d < 0.0015 + 0.0015 * t) { hitStep = i; break; }
    // op3Rep only gives a bound for the current cell; undershoot to stay safe
    t += d * 0.75;
    if (t > MAX_T) break;
  }
  if (hitStep < 0) return 0.0;

  vec3 pos = ro + rd * t;
  vec3 n = ${nrm}(pos);
  vec3 key = normalize(vec3(0.42, 0.78, -0.46));
  float ndl = clamp(dot(n, key), 0.0, 1.0);
  float head = clamp(dot(n, normalize(ro - pos)), 0.0, 1.0);
  float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.0);
  float ao = mix(0.3, 1.0, clamp(${map}(pos + n * 0.2) / 0.2, 0.0, 1.0));
  float crowd = 1.0 - 0.3 * (float(hitStep) / float(MAX_STEPS));
  float lamp = (0.88 + 0.24 * uLevel) / (1.0 + 0.2 * t * t);
  float lit = (0.12 + 0.52 * ndl + 0.36 * head * lamp) * ao * crowd + rim * 0.28;
  float fog = exp(-t * 0.2);
  // 0.06..0.94 so the material downstream always gets mid tones
  return clamp((0.06 + 0.88 * clamp(lit, 0.0, 1.0)) * fog, 0.0, 1.0);
}
`.trim();
  },
};
