import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Pre-silence black — residual very-low blue/red/green mottles; descent strips sat/value.
 * Never pure black. Returns premultiplied alpha.
 */
export const preSilenceBlackDef: GeneratorDefinition = {
  id: 'preSilenceBlack',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    affect: ['suspended', 'intimate', 'final'],
  },
  parameters: [
    {
      id: 'descent',
      label: 'Descent',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'residue',
      label: 'Residue',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.4,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.25, stateful: false },
};

export const preSilenceBlackGenerator: InlineGenerator = {
  def: preSilenceBlackDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uDescent = uniform('descent');
    const uResidue = uniform('residue');
    return /* glsl */ `
// preSilenceBlack material: residual low-lum mottles; descent strips sat/value (never pure black)
vec4 ${fnName}(float v, vec2 p) {
  float dens = clamp(v, 0.0, 1.0);
  float desc = clamp(${uDescent}, 0.0, 1.0);
  float res = clamp(${uResidue}, 0.0, 1.0);
  // strip sat and value from bright parts of v as descent rises
  float kept = dens * (1.0 - desc * 0.92);
  kept = pow(kept, 1.0 + desc * 1.5);
  // residual very-low-luminance blue/red/green mottles
  vec2 cell = floor(p * mix(12.0, 36.0, res));
  uint h = synthHashCombine(uint(int(cell.x)), uint(int(cell.y)));
  float rR = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(h, 1u));
  float rG = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(h, 2u));
  float rB = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(h, 3u));
  // pick dominant channel per cell for colored residue
  float pick = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(h, 4u));
  vec3 mott;
  if (pick < 0.33) mott = vec3(0.12, 0.02, 0.03) * rR; // red
  else if (pick < 0.66) mott = vec3(0.02, 0.1, 0.04) * rG; // green
  else mott = vec3(0.02, 0.03, 0.14) * rB; // blue
  mott *= res * (0.35 + 0.65 * (1.0 - dens));
  // base almost-black floor (never pure black)
  vec3 floorCol = vec3(0.012, 0.012, 0.018) * (0.6 + 0.4 * res);
  vec3 body = floorCol + mott + vec3(kept * 0.15);
  // further desat by descent
  float lum = dot(body, vec3(0.299, 0.587, 0.114));
  body = mix(body, vec3(lum), desc * 0.65);
  // slow breath of residue
  float breath = 0.85 + 0.15 * sin(uTime * 0.35 + rR * 6.28318530718);
  body *= breath;
  float alpha = clamp(max(kept, res * 0.08 + length(mott) * 2.0) * (0.7 + 0.3 * (1.0 - desc * 0.5)), 0.0, 1.0);
  // floor alpha so never fully empty black hole
  alpha = max(alpha, 0.04 * (0.5 + 0.5 * res));
  return vec4(body * alpha, alpha);
}
`.trim();
  },
};
