import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Cheap LED matrix material — pitch-quantized dots, per-cell dropout, saturated phosphor.
 * Returns premultiplied alpha.
 */
export const cheapLedDef: GeneratorDefinition = {
  id: 'cheapLed',
  version: 1,
  category: 'material',
  costClass: 'light',
  impl: 'inline',
  output: 'color',
  tags: {
    material: ['cheap-led'],
    culturalTexture: ['stadium', 'signage'],
    motion: ['flicker'],
    affect: ['nostalgic', 'digital'],
  },
  parameters: [
    {
      id: 'pitch',
      label: 'Pitch',
      kind: 'number',
      min: 8,
      max: 128,
      default: 32,
      modulatable: true,
    },
    {
      id: 'dropout',
      label: 'Dropout',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.08,
      modulatable: true,
    },
    {
      id: 'hue',
      label: 'Hue',
      kind: 'number',
      min: 0,
      max: 360,
      default: 15,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.4, stateful: false },
};

export const cheapLedGenerator: InlineGenerator = {
  def: cheapLedDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uPitch = uniform('pitch');
    const uDropout = uniform('dropout');
    const uHue = uniform('hue');
    const hsl2rgb = `${fnName}_hsl2rgb`;
    return /* glsl */ `
// cheapLed material: LED matrix dots + cell dropout, premultiplied alpha
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
  float pitch = max(${uPitch}, 8.0);
  float dropAmt = clamp(${uDropout}, 0.0, 1.0);
  // cell grid in aspect-ish UV space
  vec2 cell = floor(p * pitch + 0.5);
  vec2 local = fract(p * pitch + 0.5) - 0.5;
  int ix = int(cell.x);
  int iy = int(cell.y);
  uint hcell = synthHashCombine(uint(ix), uint(iy));
  float rDrop = synthRand(${seedUniform}, ${nsUniform}, hcell);
  float alive = rDrop < dropAmt ? 0.0 : 1.0;
  // circular LED die
  float led = 1.0 - smoothstep(0.22, 0.38, length(local));
  float grain = 0.85 + 0.15 * synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(hcell, 7u));
  float mask = led * alive * grain;
  float h = mod(${uHue}, 360.0) / 360.0;
  // saturated LED color (pure RGB; dens/mask only in alpha)
  vec3 col = ${hsl2rgb}(h, 0.95, 0.5 + 0.15 * dens);
  col *= 1.35;
  float alpha = clamp(dens * mask, 0.0, 1.0);
  return vec4(col * alpha, alpha);
}
`.trim();
  },
};
