import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Freezer case cyan light — pale low-sat cyan, green edges, frost, compressor hum.
 * Returns premultiplied alpha.
 */
export const freezerCyanDef: GeneratorDefinition = {
  id: 'freezerCyan',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    environment: ['late-night-store'],
    affect: ['mundane', 'sterile'],
  },
  parameters: [
    {
      id: 'frost',
      label: 'Frost',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.4,
      modulatable: true,
    },
    {
      id: 'hum',
      label: 'Hum',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.3,
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

export const freezerCyanGenerator: InlineGenerator = {
  def: freezerCyanDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uFrost = uniform('frost');
    const uHum = uniform('hum');
    const uIntensity = uniform('intensity');
    return /* glsl */ `
// freezerCyan material: pale cyan tube + frost grain + compressor cycle
vec4 ${fnName}(float v, vec2 p) {
  float dens = clamp(v, 0.0, 1.0);
  float frostAmt = clamp(${uFrost}, 0.0, 1.0);
  float humAmt = clamp(${uHum}, 0.0, 1.0);
  float intensity = max(${uIntensity}, 0.0);
  // compressor cycle brightness hum
  float humWave = 0.5 + 0.5 * sin(uTime * 1.1);
  float humPulse = mix(1.0, 0.82 + 0.18 * humWave, humAmt);
  // pale low-sat cyan, edges shift green
  float core = smoothstep(0.25, 0.9, dens);
  vec3 cyan = vec3(0.55, 0.92, 0.95);
  vec3 greenEdge = vec3(0.35, 0.85, 0.55);
  float edge = smoothstep(0.15, 0.55, dens) * (1.0 - core);
  vec3 col = mix(cyan, greenEdge, edge * 0.65);
  col = mix(vec3(0.08, 0.12, 0.14), col, 0.55 + 0.45 * core);
  // hard highlights
  float hi = pow(smoothstep(0.7, 0.98, dens), 2.0);
  col += vec3(0.75, 0.95, 1.0) * hi * 0.55;
  // thin frost noise in dark areas
  float pitch = 42.0;
  vec2 cell = floor(p * pitch + 0.5);
  uint hcell = synthHashCombine(uint(int(cell.x)), uint(int(cell.y)));
  float rF = synthRand(${seedUniform}, ${nsUniform}, hcell);
  float dark = 1.0 - smoothstep(0.0, 0.45, dens);
  float frost = step(0.72, rF) * dark * frostAmt * 0.55;
  col += vec3(0.7, 0.85, 0.9) * frost;
  float alpha = clamp((pow(dens, 1.05) * 0.9 + frost * 0.25 + hi * 0.15) * intensity * humPulse, 0.0, 1.0);
  col *= intensity * humPulse;
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
