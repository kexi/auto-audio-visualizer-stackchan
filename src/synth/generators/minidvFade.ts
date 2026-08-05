import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * MiniDV fade — lifted blacks, yellow-green white crush, AWB drift, chroma noise.
 * Returns premultiplied alpha.
 */
export const minidvFadeDef: GeneratorDefinition = {
  id: 'minidvFade',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    material: ['minidv'],
    affect: ['2000s', 'personal', 'faded'],
  },
  parameters: [
    {
      id: 'age',
      label: 'Age',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.45,
      modulatable: true,
    },
    {
      id: 'chromaNoise',
      label: 'Chroma Noise',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.35,
      modulatable: true,
    },
    {
      id: 'awbDrift',
      label: 'AWB Drift',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.4,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.3, stateful: false },
};

export const minidvFadeGenerator: InlineGenerator = {
  def: minidvFadeDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uAge = uniform('age');
    const uChromaNoise = uniform('chromaNoise');
    const uAwbDrift = uniform('awbDrift');
    return /* glsl */ `
// minidvFade material: lifted blacks, yellow-green crush, AWB drift, chroma noise
vec4 ${fnName}(float v, vec2 p) {
  float dens = clamp(v, 0.0, 1.0);
  float age = clamp(${uAge}, 0.0, 1.0);
  float chN = clamp(${uChromaNoise}, 0.0, 1.0);
  float awb = clamp(${uAwbDrift}, 0.0, 1.0);
  // base faded tape look: lift blacks, compress whites toward yellow-green
  float lift = 0.08 + 0.12 * age;
  float g = lift + dens * (1.0 - lift * 1.4);
  g = clamp(g, 0.0, 1.0);
  vec3 warmFade = vec3(0.78, 0.82, 0.55);
  vec3 body = mix(vec3(g), warmFade * g, 0.35 + 0.4 * age);
  // local red saturation (cheap DV skin/red push)
  float redPush = smoothstep(0.25, 0.85, dens) * (0.15 + 0.25 * age);
  body.r = clamp(body.r + redPush * 0.2, 0.0, 1.2);
  body.g = clamp(body.g - redPush * 0.05, 0.0, 1.0);
  // slow AWB color temp drift
  float drift = sin(uTime * 0.12) * awb;
  body.r += drift * 0.08;
  body.b -= drift * 0.1;
  body.g += sin(uTime * 0.09 + 1.3) * awb * 0.04;
  // fine temporal color noise
  uint tick = uint(floor(uTime * 24.0));
  vec2 cell = floor(p * 64.0);
  uint h = synthHashCombine(uint(int(cell.x)), uint(int(cell.y)));
  h = synthHashCombine(h, tick);
  float nR = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(h, 1u));
  float nG = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(h, 2u));
  float nB = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(h, 3u));
  vec3 noise = (vec3(nR, nG, nB) - 0.5) * chN * 0.22;
  body += noise;
  body = clamp(body, 0.0, 1.0);
  float alpha = clamp(mix(dens, g, 0.5) * (0.85 + 0.15 * (1.0 - age * 0.5)), 0.0, 1.0);
  return vec4(body * alpha, alpha);
}
`.trim();
  },
};
