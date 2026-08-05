import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Diazo blueprint (青焼き) — deep blue ground with the density read as white line work,
 * plus a faint ammonia bleed around the strokes.
 * Returns premultiplied alpha.
 */
export const blueprintDef: GeneratorDefinition = {
  id: 'blueprint',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    material: ['blueprint'],
    affect: ['technical', 'nostalgic'],
  },
  parameters: [
    {
      id: 'depth',
      label: 'Depth',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.6,
      modulatable: true,
    },
    {
      id: 'bleed',
      label: 'Bleed',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.4,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.3, stateful: false },
};

export const blueprintGenerator: InlineGenerator = {
  def: blueprintDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uDepth = uniform('depth');
    const uBleed = uniform('bleed');
    return /* glsl */ `
// blueprint material: white line work on diazo blue, fwidth bleed around strokes
vec4 ${fnName}(float v, vec2 p) {
  float dens = clamp(v, 0.0, 1.0);
  float depth = clamp(${uDepth}, 0.0, 1.0);
  float bleed = clamp(${uBleed}, 0.0, 1.0);
  vec3 ground = mix(vec3(0.09, 0.2, 0.47), vec3(0.02, 0.07, 0.28), depth);
  vec3 white = vec3(0.87, 0.92, 0.98);
  // ammonia halo around every stroke, from the density gradient
  float edge = abs(fwidth(v));
  float halo = smoothstep(0.0, 0.09, edge * 7.0) * bleed;
  float line = clamp(dens * (1.0 - 0.2 * bleed) + halo * 0.3, 0.0, 1.0);
  // uneven coating of the sheet — static, no uTime
  vec2 fc = floor(p * 40.0);
  uint fh = synthHashCombine(uint(int(fc.x)), uint(int(fc.y)));
  float mottle = synthRand(${seedUniform}, ${nsUniform}, fh);
  vec3 col = mix(ground * (0.88 + 0.24 * mottle), white, line);
  // the sheet itself is present, so the ground carries some alpha of its own
  float alpha = clamp(0.22 * (0.5 + 0.5 * depth) + line * 0.85, 0.0, 1.0);
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
