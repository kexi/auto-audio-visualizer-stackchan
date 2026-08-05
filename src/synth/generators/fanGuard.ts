import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Old electric fan grille — off-center hub, uneven spokes, distorted rings.
 */
export const fanGuardDef: GeneratorDefinition = {
  id: 'fanGuard',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    environment: ['domestic'],
    affect: ['tropical', 'uncanny'],
    motion: ['rotate'],
  },
  parameters: [
    {
      id: 'spokes',
      label: 'Spokes',
      kind: 'int',
      min: 8,
      max: 48,
      default: 20,
      modulatable: true,
    },
    {
      id: 'offCenter',
      label: 'Off Center',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'spin',
      label: 'Spin',
      kind: 'number',
      min: 0,
      max: 2,
      default: 0.3,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.55, stateful: false },
};

export const fanGuardGenerator: InlineGenerator = {
  def: fanGuardDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uSpokes = uniform('spokes');
    const uOffCenter = uniform('offCenter');
    const uSpin = uniform('spin');
    return /* glsl */ `
// fanGuard source: off-center fan grille with spin + micro vibration
float ${fnName}(vec2 p) {
  int nSp = clamp(${uSpokes}, 8, 48);
  float oc = clamp(${uOffCenter}, 0.0, 1.0);
  float sp = max(${uSpin}, 0.0);
  // center pushed toward edge based on offCenter
  float angC = synthRand(${seedUniform}, ${nsUniform}, 1u) * 6.28318530718;
  float rC = oc * 0.95;
  vec2 c = vec2(cos(angC), sin(angC)) * rC;
  // micro motor vibration
  float vib = 0.004 * sin(uTime * 47.0) + 0.003 * sin(uTime * 73.0 + 1.7);
  vec2 q = p - c + vec2(vib, vib * 0.7);
  float TAU = 6.28318530718;
  float rot = uTime * sp * 0.6;
  float ang = atan(q.y, q.x) + rot;
  float r = length(q);
  float d = 1e5;
  // uneven radial spokes
  float sector = TAU / float(nSp);
  for (int i = 0; i < 48; i++) {
    if (i >= nSp) break;
    uint idx = uint(i);
    float jitter = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 2u)) - 0.5) * sector * 0.45;
    float aSpoke = float(i) * sector + jitter;
    float da = abs(mod(ang - aSpoke + TAU * 0.5, TAU) - TAU * 0.5);
    float dSpoke = da * max(r, 1e-4);
    d = min(d, dSpoke);
  }
  // distorted rings
  for (int j = 0; j < 6; j++) {
    uint jdx = uint(j);
    float baseR = 0.08 + float(j) * 0.12 + 0.04 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(jdx, 5u));
    float wob = 0.02 * sin(ang * (2.0 + float(j)) + synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(jdx, 6u)) * TAU);
    float dRing = abs(r - (baseR + wob));
    d = min(d, dRing);
  }
  // hub
  d = min(d, abs(r - 0.05));
  float halfW = max(0.008, 1e-4);
  float px = fwidth(d);
  float w = max(halfW, px * 0.75);
  return 1.0 - smoothstep(w - px, w + px, d);
}
`.trim();
  },
};
