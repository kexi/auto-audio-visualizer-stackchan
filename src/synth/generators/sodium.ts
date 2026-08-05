import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Sodium vapor orange monochrome tone map with soft haze.
 * Returns premultiplied alpha.
 */
export const sodiumDef: GeneratorDefinition = {
  id: 'sodium',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    environment: ['urban-night'],
    material: ['sodium-vapor'],
    affect: ['nostalgic'],
  },
  parameters: [
    {
      id: 'intensity',
      label: 'Intensity',
      kind: 'number',
      min: 0,
      max: 2,
      default: 1.1,
      modulatable: true,
    },
    {
      id: 'haze',
      label: 'Haze',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.3,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.2, stateful: false },
};

export const sodiumGenerator: InlineGenerator = {
  def: sodiumDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uIntensity = uniform('intensity');
    const uHaze = uniform('haze');
    return /* glsl */ `
// sodium material: fixed orange monochrome vapor lamp + haze
vec4 ${fnName}(float v, vec2 p) {
  float dens = clamp(v, 0.0, 1.0);
  float intensity = max(${uIntensity}, 0.0);
  float hazeAmt = clamp(${uHaze}, 0.0, 1.0);
  vec3 sodium = vec3(1.0, 0.55, 0.08);
  float core = pow(dens, 1.15);
  float soft = smoothstep(0.0, 0.65, dens);
  float alpha = clamp(mix(core, soft, hazeAmt * 0.55) * intensity, 0.0, 1.0);
  vec3 col = sodium * (0.65 + 0.55 * core);
  // haze soft glow lift
  col += sodium * hazeAmt * soft * 0.35;
  col *= intensity;
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
