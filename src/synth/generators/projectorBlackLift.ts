import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Projector black lift — no pure black; center vs edge, light leak, venue-power flutter.
 * Returns premultiplied alpha.
 */
export const projectorBlackLiftDef: GeneratorDefinition = {
  id: 'projectorBlackLift',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    environment: ['venue'],
    affect: ['hazy', 'imperfect'],
  },
  parameters: [
    {
      id: 'lift',
      label: 'Lift',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.45,
      modulatable: true,
    },
    {
      id: 'leak',
      label: 'Leak',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.35,
      modulatable: true,
    },
    {
      id: 'flutter',
      label: 'Flutter',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.3,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.3, stateful: false },
};

export const projectorBlackLiftGenerator: InlineGenerator = {
  def: projectorBlackLiftDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uLift = uniform('lift');
    const uLeak = uniform('leak');
    const uFlutter = uniform('flutter');
    return /* glsl */ `
// projectorBlackLift material: lifted darks, center/edge falloff, light leak, power flutter
vec4 ${fnName}(float v, vec2 p) {
  float dens = clamp(v, 0.0, 1.0);
  float lift = clamp(${uLift}, 0.0, 1.0);
  float leakAmt = clamp(${uLeak}, 0.0, 1.0);
  float flut = clamp(${uFlutter}, 0.0, 1.0);
  // never pure black — lift darks toward blue-purple / green-grey
  vec3 liftColA = vec3(0.08, 0.06, 0.14); // blue-purple
  vec3 liftColB = vec3(0.07, 0.1, 0.09);  // green-grey
  float liftMix = 0.5 + 0.5 * sin(p.x * 1.2 + p.y * 0.8);
  vec3 floorCol = mix(liftColA, liftColB, liftMix) * (0.35 + 0.9 * lift);
  // content body above lift
  vec3 body = mix(floorCol, vec3(0.85, 0.82, 0.9), dens);
  // center brighter than edges (projector throw)
  float r = length(p);
  float fall = 1.0 - smoothstep(0.35, 1.25, r);
  body *= 0.55 + 0.55 * fall;
  // local light leak (warm corner)
  vec2 leakC = vec2(0.75, -0.65);
  float leakD = length(p - leakC);
  float leak = exp(-leakD * leakD * 3.5) * leakAmt;
  body += vec3(0.45, 0.28, 0.12) * leak * (0.4 + 0.6 * dens);
  // venue-power flicker overall brightness
  uint timeBucket = uint(floor(uTime * 7.5));
  float flR = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(timeBucket, 3u));
  float flicker = 1.0 - flut * 0.25 * step(0.88, flR);
  flicker *= 0.97 + 0.03 * sin(uTime * 48.0) * flut;
  body *= flicker;
  // lift ensures floor alpha / color never pure black
  float alpha = clamp(max(dens, lift * 0.12) * (0.75 + 0.25 * fall) + leak * 0.2, 0.0, 1.0);
  return vec4(body * alpha, alpha);
}
`.trim();
  },
};
