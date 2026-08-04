import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * CRT material — scanlines, slight chromatic aberration, vignette.
 * Returns premultiplied alpha.
 */
export const crtDef: GeneratorDefinition = {
  id: 'crt',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    material: ['crt', 'phosphor'],
    culturalTexture: ['retro', 'broadcast'],
    motion: ['scan'],
    affect: ['nostalgic', 'electric'],
  },
  parameters: [
    {
      id: 'hue',
      label: 'Hue',
      kind: 'number',
      min: 0,
      max: 360,
      default: 120,
      modulatable: true,
    },
    {
      id: 'scanline',
      label: 'Scanline',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.55,
      modulatable: true,
    },
    {
      id: 'aberration',
      label: 'Aberration',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.35,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.35, stateful: false },
};

export const crtGenerator: InlineGenerator = {
  def: crtDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform } = ctx;
    const uHue = uniform('hue');
    const uScanline = uniform('scanline');
    const uAberration = uniform('aberration');
    const hsl2rgb = `${fnName}_hsl2rgb`;
    return /* glsl */ `
// crt material: scanlines + chromatic shift + vignette, premultiplied alpha
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
  float scanAmt = clamp(${uScanline}, 0.0, 1.0);
  float aber = clamp(${uAberration}, 0.0, 1.0);
  float h = mod(${uHue}, 360.0) / 360.0;
  // pure phosphor base (dens only in lightness; no dens baked into RGB)
  vec3 col = ${hsl2rgb}(h, 0.85, 0.4 + 0.25 * dens);
  // mild chromatic bias as slight RGB scale (not densR/densB)
  float shift = aber * 0.12;
  col *= vec3(1.0 + shift * p.x, 1.0, 1.0 - shift * p.x);
  // scanlines + vignette contribute to alpha only
  float lines = 0.5 + 0.5 * cos(p.y * 220.0);
  float scan = mix(1.0, lines, scanAmt);
  float vig = smoothstep(1.15, 0.35, length(p));
  float alpha = clamp(dens * scan * vig, 0.0, 1.0);
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
