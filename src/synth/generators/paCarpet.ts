import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Old PA carpet — near-black grey short fiber noise, crushed patches, dust points; nearly static.
 * Returns premultiplied alpha.
 */
export const paCarpetDef: GeneratorDefinition = {
  id: 'paCarpet',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    material: ['speaker-carpet'],
    environment: ['backstage'],
    affect: ['tactile', 'understated'],
  },
  parameters: [
    {
      id: 'fiber',
      label: 'Fiber',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'wear',
      label: 'Wear',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.4,
      modulatable: true,
    },
    {
      id: 'dust',
      label: 'Dust',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.35,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.35, stateful: false },
};

export const paCarpetGenerator: InlineGenerator = {
  def: paCarpetDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uFiber = uniform('fiber');
    const uWear = uniform('wear');
    const uDust = uniform('dust');
    return /* glsl */ `
// paCarpet material: near-black fiber noise + crushed patches + dust (nearly static)
vec4 ${fnName}(float v, vec2 p) {
  float dens = clamp(v, 0.0, 1.0);
  float fib = clamp(${uFiber}, 0.0, 1.0);
  float wearAmt = clamp(${uWear}, 0.0, 1.0);
  float dustAmt = clamp(${uDust}, 0.0, 1.0);
  // short fiber noise in many directions — nearly static (no uTime)
  float fiberN = 0.0;
  for (int i = 0; i < 4; i++) {
    float a = float(i) * 0.78539816339 + 0.3;
    vec2 dir = vec2(cos(a), sin(a));
    float along = dot(p, dir) * 90.0;
    vec2 cell = floor(vec2(along, dot(p, vec2(-dir.y, dir.x)) * 40.0));
    uint fh = synthHashCombine(uint(int(cell.x)), uint(int(cell.y) + i * 17));
    float r = synthRand(${seedUniform}, ${nsUniform}, fh);
    fiberN += r;
  }
  fiberN *= 0.25;
  // crushed patches (larger cells, darker/flattened)
  vec2 wcell = floor(p * 6.0);
  uint wh = synthHashCombine(uint(int(wcell.x)), uint(int(wcell.y)));
  float wearR = synthRand(${seedUniform}, ${nsUniform}, wh);
  float crushed = step(1.0 - wearAmt * 0.55, wearR);
  // dust bright points
  vec2 dcell = floor(p * 72.0);
  uint dh = synthHashCombine(uint(int(dcell.x)), uint(int(dcell.y)));
  float dustR = synthRand(${seedUniform}, ${nsUniform}, dh);
  float dustPt = step(1.0 - dustAmt * 0.08, dustR);
  // near-black grey body
  float lit = 0.04 + 0.06 * mix(0.5, fiberN, fib) + dens * 0.12;
  lit *= mix(1.0, 0.55, crushed * wearAmt);
  lit += dustPt * 0.25 * dustAmt;
  vec3 col = vec3(lit * 0.95, lit * 0.97, lit);
  // slight brownish wear tint in crushed zones
  col = mix(col, vec3(lit * 1.05, lit * 0.95, lit * 0.85), crushed * wearAmt * 0.4);
  float alpha = clamp(dens * (0.8 + 0.2 * fiberN) + dustPt * dustAmt * 0.15, 0.0, 1.0);
  // carpet always has some presence under density
  alpha = max(alpha, 0.12 * fib * dens);
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
