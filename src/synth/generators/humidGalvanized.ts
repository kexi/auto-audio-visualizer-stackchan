import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Wet galvanized steel — blue-grey base, crystal spangles, per-spangle reflection, water film.
 * Returns premultiplied alpha.
 */
export const humidGalvanizedDef: GeneratorDefinition = {
  id: 'humidGalvanized',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    material: ['galvanized-steel'],
    affect: ['industrial', 'humid', 'cold'],
  },
  parameters: [
    {
      id: 'spangle',
      label: 'Spangle',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'film',
      label: 'Film',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.4,
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
  cost: { passes: 0, relativeFill: 0.35, stateful: false },
};

export const humidGalvanizedGenerator: InlineGenerator = {
  def: humidGalvanizedDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uSpangle = uniform('spangle');
    const uFilm = uniform('film');
    const uIntensity = uniform('intensity');
    return /* glsl */ `
// humidGalvanized material: blue-grey steel + crystal spangles + wet film
vec4 ${fnName}(float v, vec2 p) {
  float dens = clamp(v, 0.0, 1.0);
  float sp = clamp(${uSpangle}, 0.0, 1.0);
  float filmAmt = clamp(${uFilm}, 0.0, 1.0);
  float intensity = max(${uIntensity}, 0.0);
  // blue-grey base
  vec3 base = vec3(0.42, 0.48, 0.52);
  // large + small spangle cells
  vec2 cellL = floor(p * mix(4.0, 10.0, sp));
  vec2 cellS = floor(p * mix(18.0, 40.0, sp));
  uint hL = synthHashCombine(uint(int(cellL.x)), uint(int(cellL.y)));
  uint hS = synthHashCombine(uint(int(cellS.x)), uint(int(cellS.y)));
  float rL = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(hL, 1u));
  float rS = synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(hS, 2u));
  // crystal facet shape inside large cell
  vec2 fL = fract(p * mix(4.0, 10.0, sp)) - 0.5;
  float facet = 1.0 - smoothstep(0.15, 0.48, length(fL * vec2(1.0, 0.85 + 0.3 * rL)));
  // per-spangle reflection direction
  float ang = rL * 6.28318530718;
  vec2 refDir = vec2(cos(ang), sin(ang));
  float view = dot(normalize(p + 0.001), refDir);
  float spec = pow(max(view * 0.5 + 0.5, 0.0), mix(4.0, 12.0, rS)) * facet;
  // mix large/small spangle contrast
  float spangleLit = mix(0.75, 1.15, rL) * mix(0.9, 1.1, rS);
  vec3 col = base * spangleLit;
  col += vec3(0.55, 0.62, 0.7) * spec * sp * 0.85;
  col += vec3(0.2, 0.25, 0.3) * facet * sp * 0.25;
  // thin water film: local contrast boost
  float filmN = 0.5 + 0.5 * sin(p.x * 9.0 + p.y * 7.0 + uTime * 0.4);
  float filmMask = smoothstep(0.35, 0.85, dens) * filmAmt * filmN;
  col = mix(col, col * 1.25 + vec3(0.08, 0.1, 0.12), filmMask);
  // cold humidity lift in darks
  col = mix(col, col * vec3(0.9, 0.95, 1.05), 0.2);
  col *= intensity * (0.55 + 0.55 * dens);
  float alpha = clamp(dens * intensity * (0.75 + 0.25 * facet), 0.0, 1.0);
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
