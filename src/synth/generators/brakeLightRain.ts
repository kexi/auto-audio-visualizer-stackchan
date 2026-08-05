import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Brake light in rain — deep red highlights with procedural vertical streak reflections.
 * Returns premultiplied alpha.
 *
 * Material only receives v at a point so reflection is a procedural approximation
 * (p vertical attenuation × wobble × v).
 */
export const brakeLightRainDef: GeneratorDefinition = {
  id: 'brakeLightRain',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    environment: ['urban-night'],
    affect: ['nocturnal', 'wet'],
    culturalTexture: ['taiwan-streetscape'],
  },
  parameters: [
    {
      id: 'intensity',
      label: 'Intensity',
      kind: 'number',
      min: 0,
      max: 2,
      default: 1.2,
      modulatable: true,
    },
    {
      id: 'streak',
      label: 'Streak',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'wetness',
      label: 'Wetness',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.5,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.35, stateful: false },
};

export const brakeLightRainGenerator: InlineGenerator = {
  def: brakeLightRainDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uIntensity = uniform('intensity');
    const uStreak = uniform('streak');
    const uWetness = uniform('wetness');
    return /* glsl */ `
// brakeLightRain material: deep red + procedural vertical streak reflection
// Material only receives v at a point so reflection is procedural approximation
// (p vertical attenuation × wobble × v).
vec4 ${fnName}(float v, vec2 p) {
  float dens = clamp(v, 0.0, 1.0);
  float intensity = max(${uIntensity}, 0.0);
  float streakAmt = clamp(${uStreak}, 0.0, 1.0);
  float wet = clamp(${uWetness}, 0.0, 1.0);
  // deterministic light on/dim cycle
  uint cycle = uint(floor(uTime * 0.35));
  float cR = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(cycle, 1u));
  float live = mix(0.55, 1.0, step(0.25, cR));
  live *= 0.9 + 0.1 * sin(uTime * 2.2);
  // dark bg, deep red high-brightness where v is high
  float core = pow(dens, 1.2);
  vec3 red = vec3(0.95, 0.05, 0.04);
  vec3 deep = vec3(0.35, 0.02, 0.02);
  vec3 col = mix(deep, red, core) * live;
  col += vec3(1.0, 0.25, 0.12) * smoothstep(0.55, 0.95, dens) * 0.55 * live;
  // procedural vertical streak reflection down from hot spots
  // (p vertical attenuation × wobble × v)
  float fall = smoothstep(0.4, -1.0, p.y);
  float wobble = 0.5 + 0.5 * sin(p.y * 18.0 + uTime * 1.5 + p.x * 6.0);
  float streak = dens * fall * wobble * streakAmt * wet;
  col += red * streak * 0.85;
  float alpha = clamp((core * 0.85 + streak * 0.45) * intensity * live, 0.0, 1.0);
  // wetness lifts dark floor slightly (wet asphalt glint)
  alpha = max(alpha, wet * dens * 0.12);
  col *= intensity;
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
