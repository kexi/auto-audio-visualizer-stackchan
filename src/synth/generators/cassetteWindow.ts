import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Cassette window — stacked rounded-rect windows with asymmetric hubs and transport lines.
 */
export const cassetteWindowDef: GeneratorDefinition = {
  id: 'cassetteWindow',
  version: 1,
  category: 'source',
  costClass: 'medium',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['cassette'],
    affect: ['analog', 'personal', 'obsolete'],
  },
  parameters: [
    {
      id: 'windows',
      label: 'Windows',
      kind: 'int',
      min: 1,
      max: 4,
      default: 2,
      modulatable: true,
    },
    {
      id: 'hubSpin',
      label: 'Hub Spin',
      kind: 'number',
      min: 0,
      max: 2,
      default: 0.7,
      modulatable: true,
    },
    {
      id: 'lines',
      label: 'Lines',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.65,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.5, stateful: false },
};

export const cassetteWindowGenerator: InlineGenerator = {
  def: cassetteWindowDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uWindows = uniform('windows');
    const uHubSpin = uniform('hubSpin');
    const uLines = uniform('lines');
    return /* glsl */ `
// cassetteWindow source: stacked rounded windows, asymmetric hubs, transport lines
float ${fnName}(vec2 p) {
  int nWin = clamp(${uWindows}, 1, 4);
  float spin = max(${uHubSpin}, 0.0);
  float lineAmt = clamp(${uLines}, 0.0, 1.0);
  float dens = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= nWin) break;
    uint idx = uint(i);
    float cx = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 1u)) - 0.5) * 0.55;
    float cy = mix(-0.55, 0.55, (float(i) + 0.5) / float(nWin));
    cy += (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 2u)) - 0.5) * 0.08;
    float hw = 0.22 + 0.14 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 3u));
    float hh = 0.08 + 0.06 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 4u));
    float corner = min(hh, hw) * 0.35;
    vec2 q = p - vec2(cx, cy);
    // rounded rect SDF (box + corner)
    vec2 b = vec2(hw, hh) - vec2(corner);
    vec2 d = abs(q) - b;
    float sdf = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - corner;
    float dOutline = abs(sdf);
    float halfW = max(0.01, 1e-4);
    float px = fwidth(dOutline);
    float w = max(halfW, px * 0.75);
    float win = 1.0 - smoothstep(w - px, w + px, dOutline);
    dens = max(dens, win);
    // two hubs asymmetric on x
    float hubOff = 0.08 + 0.12 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 5u));
    float hubR = 0.035 + 0.02 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 6u));
    vec2 h1 = vec2(-hubOff * 1.15, 0.0);
    vec2 h2 = vec2(hubOff * 0.85, 0.0);
    float spd1 = spin * (0.4 + 0.8 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 7u)));
    float spd2 = spin * (0.3 + 0.9 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 8u)));
    // hub rings
    float dH1 = abs(length(q - h1) - hubR);
    float dH2 = abs(length(q - h2) - hubR);
    float pxH = fwidth(dH1);
    float wH = max(0.008, pxH * 0.75);
    dens = max(dens, 1.0 - smoothstep(wH - pxH, wH + pxH, dH1));
    dens = max(dens, 1.0 - smoothstep(wH - pxH, wH + pxH, dH2));
    // rotating spokes inside hubs
    float a1 = atan(q.y - h1.y, q.x - h1.x) + uTime * spd1;
    float a2 = atan(q.y - h2.y, q.x - h2.x) - uTime * spd2 * 1.1;
    float r1 = length(q - h1);
    float r2 = length(q - h2);
    float spoke1 = abs(mod(a1, 1.04719755) - 0.52359877) * max(r1, 1e-4);
    float spoke2 = abs(mod(a2, 1.04719755) - 0.52359877) * max(r2, 1e-4);
    float inHub1 = 1.0 - smoothstep(hubR * 0.2, hubR * 0.95, r1);
    float inHub2 = 1.0 - smoothstep(hubR * 0.2, hubR * 0.95, r2);
    float pxS = fwidth(spoke1);
    float wS = max(0.006, pxS * 0.75);
    dens = max(dens, (1.0 - smoothstep(wS - pxS, wS + pxS, spoke1)) * inHub1);
    dens = max(dens, (1.0 - smoothstep(wS - pxS, wS + pxS, spoke2)) * inHub2);
    // thin horizontal transport lines inside window
    if (lineAmt > 0.02) {
      for (int j = 0; j < 3; j++) {
        float ly = mix(-hh * 0.55, hh * 0.55, (float(j) + 0.5) / 3.0);
        float dL = abs(q.y - ly);
        float insideX = 1.0 - smoothstep(hw * 0.85, hw * 0.95, abs(q.x));
        float pxL = fwidth(dL);
        float wL = max(0.004, pxL * 0.75);
        dens = max(dens, (1.0 - smoothstep(wL - pxL, wL + pxL, dL)) * insideX * lineAmt * 0.7);
      }
    }
  }
  return clamp(dens, 0.0, 1.0);
}
`.trim();
  },
};
