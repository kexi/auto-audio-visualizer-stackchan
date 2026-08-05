import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Cheap karaoke LCD — strong blue, purple darks, cyan highs; narrow viewing angle drift.
 * Returns premultiplied alpha.
 */
export const karaokeLcdDef: GeneratorDefinition = {
  id: 'karaokeLcd',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    culturalTexture: ['east-asia-karaoke'],
    affect: ['cheap', 'festive', '2000s'],
  },
  parameters: [
    {
      id: 'angleDrift',
      label: 'Angle Drift',
      kind: 'number',
      min: 0,
      max: 2,
      default: 0.7,
      modulatable: true,
    },
    {
      id: 'cheapness',
      label: 'Cheapness',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'intensity',
      label: 'Intensity',
      kind: 'number',
      min: 0,
      max: 2,
      default: 1.1,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.3, stateful: false },
};

export const karaokeLcdGenerator: InlineGenerator = {
  def: karaokeLcdDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uAngleDrift = uniform('angleDrift');
    const uCheapness = uniform('cheapness');
    const uIntensity = uniform('intensity');
    return /* glsl */ `
// karaokeLcd material: blue LCD + purple darks + cyan highs + viewing-angle invert/desat
vec4 ${fnName}(float v, vec2 p) {
  float dens = clamp(v, 0.0, 1.0);
  float drift = max(${uAngleDrift}, 0.0);
  float cheap = clamp(${uCheapness}, 0.0, 1.0);
  float intensity = max(${uIntensity}, 0.0);
  // strong blue base, purple in darks, cyan highlights
  vec3 purple = vec3(0.25, 0.08, 0.45);
  vec3 blue = vec3(0.1, 0.25, 0.85);
  vec3 cyan = vec3(0.25, 0.9, 0.95);
  vec3 col = mix(purple, blue, smoothstep(0.0, 0.55, dens));
  col = mix(col, cyan, smoothstep(0.55, 1.0, dens));
  // virtual view angle drifts vertically
  float viewY = p.y + sin(uTime * 0.15 * drift) * 0.55 * drift;
  float offAxis = smoothstep(0.15, 0.85, abs(viewY));
  // narrow viewing angle: tone invert + desat by position
  float invAmt = offAxis * cheap * 0.85;
  vec3 inv = 1.0 - col;
  col = mix(col, inv, invAmt * 0.65);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum), offAxis * cheap * 0.7);
  // cheap panel banding
  float band = 0.5 + 0.5 * sin(p.y * mix(40.0, 90.0, cheap) + uTime * 0.5);
  col *= mix(1.0, 0.88 + 0.18 * band, cheap * 0.5);
  col *= intensity;
  float alpha = clamp(dens * intensity * (0.75 + 0.25 * (1.0 - offAxis * 0.4)), 0.0, 1.0);
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
