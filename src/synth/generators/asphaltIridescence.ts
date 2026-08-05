import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Road oil film — dark grey + low-sat thin-film along closed curves; grit; view-shift interference.
 * Returns premultiplied alpha.
 */
export const asphaltIridescenceDef: GeneratorDefinition = {
  id: 'asphaltIridescence',
  version: 1,
  category: 'material',
  costClass: 'medium',
  impl: 'inline',
  output: 'color',
  tags: {
    environment: ['urban'],
    affect: ['wet', 'accidental'],
  },
  parameters: [
    {
      id: 'patches',
      label: 'Patches',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'shift',
      label: 'Shift',
      kind: 'number',
      min: 0,
      max: 2,
      default: 0.7,
      modulatable: true,
    },
    {
      id: 'grit',
      label: 'Grit',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.45,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.4, stateful: false },
};

export const asphaltIridescenceGenerator: InlineGenerator = {
  def: asphaltIridescenceDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uPatches = uniform('patches');
    const uShift = uniform('shift');
    const uGrit = uniform('grit');
    const hsl2rgb = `${fnName}_hsl2rgb`;
    return /* glsl */ `
// asphaltIridescence material: oil film on dark asphalt with grit + view shift
vec3 ${hsl2rgb}(float h, float s, float l) {
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float hp = mod(h, 1.0) * 6.0;
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  vec3 rgb;
  if (hp < 1.0) rgb = vec3(c, x, 0.0);
  else if (hp < 2.0) rgb = vec3(x, c, 0.0);
  else if (hp < 3.0) rgb = vec3(0.0, c, x);
  else if (hp < 4.0) rgb = vec3(0.0, x, c);
  else if (hp < 5.0) rgb = vec3(x, 0.0, c);
  else rgb = vec3(c, 0.0, x);
  float m = l - 0.5 * c;
  return rgb + m;
}
vec4 ${fnName}(float v, vec2 p) {
  float dens = clamp(v, 0.0, 1.0);
  float pat = clamp(${uPatches}, 0.0, 1.0);
  float sh = max(${uShift}, 0.0);
  float gr = clamp(${uGrit}, 0.0, 1.0);
  // dark asphalt base
  vec3 asphalt = vec3(0.08, 0.085, 0.09);
  // grit noise
  vec2 gcell = floor(p * 48.0);
  uint gh = synthHashCombine(uint(int(gcell.x)), uint(int(gcell.y)));
  float gritN = synthRand(${seedUniform}, ${nsUniform}, gh);
  asphalt *= mix(1.0, 0.7 + 0.55 * gritN, gr);
  // oil patches: smooth closed curves via multi-lobe distance
  float oil = 0.0;
  for (int i = 0; i < 4; i++) {
    uint idx = uint(i);
    float cx = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 1u)) - 0.5) * 1.4;
    float cy = (synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 2u)) - 0.5) * 1.4;
    float rx = 0.15 + 0.25 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 3u));
    float ry = 0.1 + 0.2 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(idx, 4u));
    vec2 q = p - vec2(cx, cy);
    // soft ellipse blob
    float e = length(vec2(q.x / rx, q.y / ry));
    float blob = 1.0 - smoothstep(0.6, 1.15, e);
    // closed curve rings of interference
    float ring = abs(sin(e * 6.0 - uTime * sh * 0.15));
    oil = max(oil, blob * (0.35 + 0.65 * ring));
  }
  oil *= pat;
  // view-dependent thin-film hue (purple/green/orange)
  float view = p.x * 0.4 + p.y * 0.3 + uTime * sh * 0.05;
  float ht = fract(view * 0.7 + oil * 1.5);
  float hue;
  if (ht < 0.4) hue = mix(0.78, 0.35, ht / 0.4); // purple→green
  else if (ht < 0.7) hue = mix(0.35, 0.08, (ht - 0.4) / 0.3); // green→orange
  else hue = mix(0.08, 0.78, (ht - 0.7) / 0.3);
  vec3 film = ${hsl2rgb}(hue, 0.35 + 0.2 * oil, 0.22 + 0.2 * oil);
  vec3 col = mix(asphalt, film, oil * 0.85);
  col = mix(col, col * (0.9 + dens * 0.35), 0.5);
  float alpha = clamp(mix(dens * 0.85, max(dens, oil * 0.55), pat), 0.0, 1.0);
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
