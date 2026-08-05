import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Image source — the first generator with a texture input slot.
 *
 * A loaded image (PNG / JPG / WebP, or a rasterized SVG) becomes the density
 * field v, so every existing Modifier / Material / Field applies to it: an event
 * logo can be halftoned, kaleidoscoped, glitched or diffracted like any other
 * procedural source. The seed gacha changes how the logo is *cooked*, not
 * whether it is there.
 *
 * density = luminance × alpha (invert → (1 - luminance) × alpha, which is what
 * a dark logo on a light/transparent background needs).
 *
 * With no image bound the scene binds a 1×1 transparent dummy, so alpha is 0 and
 * v collapses to 0 — an empty frame, never a crash.
 */
export const stampDef: GeneratorDefinition = {
  id: 'stamp',
  version: 1,
  category: 'source',
  costClass: 'light',
  impl: 'inline',
  output: 'field',
  textures: ['image'],
  tags: {
    material: ['photographic', 'print'],
    culturalTexture: ['signage', 'logo'],
    affect: ['literal'],
  },
  parameters: [
    {
      id: 'fit',
      label: 'Fit',
      kind: 'enum',
      options: ['contain', 'cover', 'tile'],
      default: 'contain',
      modulatable: false,
    },
    {
      id: 'scale',
      label: 'Scale',
      kind: 'number',
      min: 0.2,
      max: 4,
      default: 1,
      modulatable: true,
    },
    {
      id: 'invert',
      label: 'Invert',
      kind: 'bool',
      default: false,
      modulatable: false,
    },
  ],
  cost: { passes: 0, relativeFill: 0.3, stateful: false },
};

export const stampGenerator: InlineGenerator = {
  def: stampDef,
  emit(ctx: EmitContext): string {
    const { fnName, uniform, texUniform, texSizeUniform } = ctx;
    const uFit = uniform('fit');
    const uScale = uniform('scale');
    const uInvert = uniform('invert');
    const tex = texUniform('image');
    const texSize = texSizeUniform('image');
    return /* glsl */ `
// stamp source: image luminance×alpha as density; fit 0=contain, 1=cover, 2=tile
float ${fnName}(vec2 p) {
  // p is aspect-corrected and origin-centered: x spans ±aspect/2, y spans ±0.5.
  vec2 size = max(${texSize}, vec2(1.0));
  float imgAspect = size.x / size.y;
  // Canvas extent in p-space: height is always 1, width is the canvas aspect.
  float canvasAspect = uRes.x / max(uRes.y, 1.0);
  int fit = ${uFit};
  float scale = max(${uScale}, 1e-3);

  // Height of the drawn image in p-space; width follows from the image aspect.
  float h;
  if (fit == 0) {
    h = min(1.0, canvasAspect / imgAspect); // contain: whole image visible
  } else if (fit == 1) {
    h = max(1.0, canvasAspect / imgAspect); // cover: canvas fully covered
  } else {
    h = 1.0; // tile: one copy per unit height, repeated
  }
  h *= scale;
  vec2 extent = vec2(max(h * imgAspect, 1e-4), max(h, 1e-4));

  vec2 uv = p / extent + 0.5;
  float mask;
  if (fit == 2) {
    uv = fract(uv);
    mask = 1.0;
  } else {
    // Outside the placed image the density is 0 — never a smeared edge texel.
    vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
    mask = inside.x * inside.y;
  }

  vec4 texel = texture(${tex}, uv);
  float lum = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));
  float density = (${uInvert} != 0) ? (1.0 - lum) : lum;
  // Alpha gates everything: a missing image is a transparent dummy → v = 0.
  return clamp(density * texel.a * mask, 0.0, 1.0);
}
`.trim();
  },
};
