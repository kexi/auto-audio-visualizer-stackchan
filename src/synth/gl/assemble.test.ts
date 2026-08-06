import { describe, expect, it } from 'vitest';
import {
  assemblePatch,
  nsUniformName,
  SEED_UNIFORM,
  textureSizeUniformName,
  textureUniformName,
  uniformName,
} from './assemble';
import { createInlineCatalog, inlineCatalog, stampGenerator } from '../generators';
import { knownPreludeKeys, resolvePreludes } from './preludes';
import type { GeneratorDefinition, VisualPatch } from '../types';
import type { EmitContext, InlineGenerator } from '../generators/types';

function defaultPatch(seed = 'test-seed'): VisualPatch {
  return {
    schemaVersion: 1,
    seed,
    operators: [
      {
        id: 'src0',
        generatorId: 'grid',
        generatorVersion: 1,
        parameters: { cells: 8, thickness: 0.08 },
      },
      {
        id: 'fld0',
        generatorId: 'noise',
        generatorVersion: 1,
        parameters: { scale: 2, amount: 0.15 },
      },
      {
        id: 'mod0',
        generatorId: 'mirror',
        generatorVersion: 1,
        parameters: { axis: 'x' },
      },
      {
        id: 'mat0',
        generatorId: 'neon',
        generatorVersion: 1,
        parameters: { hue: 200, intensity: 1.2 },
      },
    ],
    routes: [],
    palette: { mode: 'mono', hueOffset: 0, saturation: 80, lightness: 55 },
    composition: { symmetry: 4, scale: 1, speed: 1 },
    qualityTier: 'medium',
  };
}

describe('synth/gl/assemblePatch', () => {
  it('same patch → identical fragSrc (deterministic)', () => {
    const patch = defaultPatch();
    const a = assemblePatch(patch, inlineCatalog);
    const b = assemblePatch(patch, inlineCatalog);
    expect(a.fragSrc).toBe(b.fragSrc);
    expect(a.uniforms).toEqual(b.uniforms);
    expect(a.nsUniforms).toEqual(b.nsUniforms);
  });

  it('uniform names follow u_<opId>_<paramId>', () => {
    const patch = defaultPatch();
    const { uniforms, nsUniforms, fragSrc } = assemblePatch(patch, inlineCatalog);

    expect(uniformName('src0', 'cells')).toBe('u_src0_cells');
    expect(uniformName('fld0', 'amount')).toBe('u_fld0_amount');
    expect(nsUniformName('mod0')).toBe('uNs_mod0');
    expect(SEED_UNIFORM).toBe('uSeed');

    expect(uniforms).toEqual(
      expect.arrayContaining([
        { opId: 'src0', paramId: 'cells', name: 'u_src0_cells' },
        { opId: 'src0', paramId: 'thickness', name: 'u_src0_thickness' },
        { opId: 'fld0', paramId: 'scale', name: 'u_fld0_scale' },
        { opId: 'fld0', paramId: 'amount', name: 'u_fld0_amount' },
        { opId: 'mod0', paramId: 'axis', name: 'u_mod0_axis' },
        { opId: 'mat0', paramId: 'hue', name: 'u_mat0_hue' },
        { opId: 'mat0', paramId: 'intensity', name: 'u_mat0_intensity' },
      ]),
    );
    expect(nsUniforms).toEqual([
      { opId: 'src0', name: 'uNs_src0' },
      { opId: 'fld0', name: 'uNs_fld0' },
      { opId: 'mod0', name: 'uNs_mod0' },
      { opId: 'mat0', name: 'uNs_mat0' },
    ]);

    expect(fragSrc).toContain('uniform int u_src0_cells;');
    expect(fragSrc).toContain('uniform float u_src0_thickness;');
    expect(fragSrc).toContain('uniform float u_fld0_amount;');
    expect(fragSrc).toContain('uniform int u_mod0_axis;');
    expect(fragSrc).toContain(`uniform uint ${SEED_UNIFORM};`);
  });

  it('main() call order: coord mod → field → source → material', () => {
    const { fragSrc } = assemblePatch(defaultPatch(), inlineCatalog);

    // Extract main body roughly
    const mainStart = fragSrc.indexOf('void main()');
    expect(mainStart).toBeGreaterThanOrEqual(0);
    const main = fragSrc.slice(mainStart);

    const idxCoord = main.indexOf('p = mod_coord_0(p);');
    const idxField = main.indexOf('p += field_0(p) * u_fld0_amount;');
    const idxSource = main.indexOf('v = max(v, source_0(p));');
    const idxMaterial = main.indexOf('fragColor = material_0(v, p);');

    expect(idxCoord).toBeGreaterThanOrEqual(0);
    expect(idxField).toBeGreaterThanOrEqual(0);
    expect(idxSource).toBeGreaterThanOrEqual(0);
    expect(idxMaterial).toBeGreaterThanOrEqual(0);

    expect(idxCoord).toBeLessThan(idxField);
    expect(idxField).toBeLessThan(idxSource);
    expect(idxSource).toBeLessThan(idxMaterial);
  });

  it('sanitizes non-alphanumeric opIds in uniform names', () => {
    const patch = defaultPatch();
    patch.operators[0] = {
      ...patch.operators[0]!,
      id: 'src-0!',
    };
    const { uniforms, fragSrc } = assemblePatch(patch, inlineCatalog);
    expect(uniforms.find((u) => u.paramId === 'cells')?.name).toBe('u_src_0__cells');
    expect(fragSrc).toContain('uniform int u_src_0__cells;');
  });

  it('throws on missing generator', () => {
    const patch = defaultPatch();
    patch.operators[0] = {
      id: 'x',
      generatorId: 'does-not-exist',
      generatorVersion: 1,
      parameters: {},
    };
    expect(() => assemblePatch(patch, inlineCatalog)).toThrow(/not found/);
  });

  it('emits function definitions for all four roles', () => {
    const { fragSrc } = assemblePatch(defaultPatch(), inlineCatalog);
    expect(fragSrc).toMatch(/float source_0\(vec2 p\)/);
    expect(fragSrc).toMatch(/vec2 field_0\(vec2 p\)/);
    expect(fragSrc).toMatch(/vec2 mod_coord_0\(vec2 p\)/);
    expect(fragSrc).toMatch(/vec4 material_0\(float v, vec2 p\)/);
    expect(fragSrc).toContain('synthRand');
  });

  it('includes uFade uniform and multiplies fragColor by it', () => {
    const { fragSrc } = assemblePatch(defaultPatch(), inlineCatalog);
    expect(fragSrc).toContain('uniform float uFade;');
    expect(fragSrc).toContain('fragColor *= uFade');
  });
});

/** Patch with a stamp (textures: ['image']) as its source. */
function stampPatch(opId = 'src0'): VisualPatch {
  const patch = defaultPatch();
  return {
    ...patch,
    operators: [
      {
        id: opId,
        generatorId: 'stamp',
        generatorVersion: 1,
        parameters: { fit: 'contain', scale: 1, invert: false },
      },
      patch.operators[3]!,
    ],
    images: { [`${opId}.image`]: { name: 'logo.png', hash: 'abc123' } },
  };
}

describe('synth/gl/assemblePatch texture slots', () => {
  it('texture-free patches declare no samplers and keep the header unchanged', () => {
    const { fragSrc, textures } = assemblePatch(defaultPatch(), inlineCatalog);
    expect(textures).toEqual([]);
    expect(fragSrc).not.toContain('sampler2D');
    expect(fragSrc).not.toContain('precision highp sampler2D;');
  });

  it('declares sampler2D + size uniform for every declared slot', () => {
    const { fragSrc, textures } = assemblePatch(stampPatch(), inlineCatalog);

    expect(textureUniformName('src0', 'image')).toBe('u_src0_tex_image');
    expect(textureSizeUniformName('src0', 'image')).toBe('u_src0_tex_image_size');

    expect(fragSrc).toContain('precision highp sampler2D;');
    expect(fragSrc).toContain('uniform sampler2D u_src0_tex_image;');
    expect(fragSrc).toContain('uniform vec2 u_src0_tex_image_size;');
    expect(fragSrc).toContain('texture(u_src0_tex_image');
    expect(textures).toEqual([
      {
        opId: 'src0',
        slot: 'image',
        key: 'src0.image',
        name: 'u_src0_tex_image',
        sizeName: 'u_src0_tex_image_size',
      },
    ]);
  });

  it('binding info is per operator, so two stamps get separate samplers', () => {
    const base = stampPatch();
    const patch: VisualPatch = {
      ...base,
      operators: [base.operators[0]!, { ...base.operators[0]!, id: 'src1' }, base.operators[1]!],
    };
    const { textures, fragSrc } = assemblePatch(patch, inlineCatalog);
    expect(textures.map((t) => t.key)).toEqual(['src0.image', 'src1.image']);
    expect(fragSrc).toContain('uniform sampler2D u_src0_tex_image;');
    expect(fragSrc).toContain('uniform sampler2D u_src1_tex_image;');
  });

  it('sanitizes opIds in texture uniform names', () => {
    const { textures, fragSrc } = assemblePatch(stampPatch('src-0!'), inlineCatalog);
    expect(textures[0]!.name).toBe('u_src_0__tex_image');
    // The Patch key keeps the raw opId; only the GLSL identifier is sanitized.
    expect(textures[0]!.key).toBe('src-0!.image');
    expect(fragSrc).toContain('uniform sampler2D u_src_0__tex_image;');
  });

  it('assembly stays deterministic with textures present', () => {
    const patch = stampPatch();
    const a = assemblePatch(patch, inlineCatalog);
    const b = assemblePatch(patch, inlineCatalog);
    expect(a.fragSrc).toBe(b.fragSrc);
    expect(a.textures).toEqual(b.textures);
  });

  it('assembles a patch whose generator declares a slot but no prelude', () => {
    const { fragSrc } = assemblePatch(stampPatch(), inlineCatalog);
    expect(fragSrc).not.toContain('shared preludes');
  });

  it('throws when a generator asks for a slot it never declared', () => {
    const badDef: GeneratorDefinition = {
      ...stampGenerator.def,
      id: 'bad-stamp',
      textures: ['image'],
    };
    const bad: InlineGenerator = {
      def: badDef,
      emit: (ctx: EmitContext) =>
        `float ${ctx.fnName}(vec2 p) { return ${ctx.texUniform('nope')}; }`,
    };
    const catalog = createInlineCatalog([bad, ...inlineCatalog.all()]);
    const patch: VisualPatch = {
      ...stampPatch(),
      operators: [
        { id: 'src0', generatorId: 'bad-stamp', generatorVersion: 1, parameters: {} },
        defaultPatch().operators[3]!,
      ],
    };
    expect(() => assemblePatch(patch, catalog)).toThrow(/does not declare/);
  });
});

/** Count non-overlapping occurrences of a literal substring. */
function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return n;
    n += 1;
    from = at + needle.length;
  }
}

/** A minimal inline source that declares the given prelude keys. */
function preludeSource(id: string, preludes: readonly string[]): InlineGenerator {
  const def: GeneratorDefinition = {
    id,
    version: 1,
    category: 'source',
    costClass: 'light',
    impl: 'inline',
    output: 'field',
    tags: {},
    parameters: [],
    cost: { passes: 0, relativeFill: 0.1, stateful: false },
  };
  return {
    def,
    preludes,
    emit: (ctx: EmitContext) =>
      `float ${ctx.fnName}(vec2 p) { return sd3Sphere(vec3(p, 0.0), 0.5); }`,
  };
}

/** Patch of the given generator ids, in order, closed off with a neon material. */
function patchOf(ids: string[]): VisualPatch {
  const base = defaultPatch();
  return {
    ...base,
    operators: [
      ...ids.map((generatorId, i) => ({
        id: `src${i}`,
        generatorId,
        generatorVersion: 1,
        parameters: {},
      })),
      base.operators[3]!,
    ],
  };
}

describe('synth/gl preludes', () => {
  const SPHERE_DECL = 'float sd3Sphere(vec3 p, float r) {';

  it('resolvePreludes dedupes and keeps first-seen order', () => {
    const once = resolvePreludes(['sdf3d']);
    expect(once).toContain(SPHERE_DECL);
    expect(resolvePreludes(['sdf3d', 'sdf3d', 'sdf3d'])).toBe(once);
    expect(resolvePreludes([])).toBe('');
    expect(knownPreludeKeys()).toContain('sdf3d');
  });

  it('resolvePreludes throws on an unknown key instead of skipping it', () => {
    expect(() => resolvePreludes(['sdf3d', 'no-such-prelude'])).toThrow(
      /unknown prelude "no-such-prelude"/,
    );
  });

  it('two generators requesting the same prelude emit it exactly once', () => {
    const catalog = createInlineCatalog([
      preludeSource('prelude-a', ['sdf3d']),
      preludeSource('prelude-b', ['sdf3d']),
      ...inlineCatalog.all(),
    ]);
    const { fragSrc } = assemblePatch(patchOf(['prelude-a', 'prelude-b']), catalog);
    expect(countOccurrences(fragSrc, SPHERE_DECL)).toBe(1);
    // both generator bodies are still emitted — dedupe must not drop an operator
    expect(fragSrc).toMatch(/float source_0\(vec2 p\)/);
    expect(fragSrc).toMatch(/float source_1\(vec2 p\)/);
  });

  it('the real 3D generators share one copy of sdf3d', () => {
    const patch = patchOf(['sdfTunnel', 'sdfLattice', 'sdfBlob', 'sdfCube']);
    const { fragSrc } = assemblePatch(patch, inlineCatalog);
    expect(countOccurrences(fragSrc, SPHERE_DECL)).toBe(1);
    expect(countOccurrences(fragSrc, 'vec2 rot2(vec2 p, float a) {')).toBe(1);
  });

  it('the prelude is emitted before every generator function', () => {
    const { fragSrc } = assemblePatch(patchOf(['sdfTunnel', 'sdfBlob']), inlineCatalog);
    const preludeAt = fragSrc.indexOf(SPHERE_DECL);
    const genAt = fragSrc.indexOf('// --- generator functions ---');
    expect(preludeAt).toBeGreaterThanOrEqual(0);
    expect(genAt).toBeGreaterThanOrEqual(0);
    expect(preludeAt).toBeLessThan(genAt);
  });

  it('patches without a prelude request keep a prelude-free source', () => {
    const { fragSrc } = assemblePatch(defaultPatch(), inlineCatalog);
    expect(fragSrc).not.toContain('sd3Sphere');
    expect(fragSrc).not.toContain('// --- shared preludes ---');
  });

  it('assemblePatch throws when a generator declares an unknown prelude', () => {
    const catalog = createInlineCatalog([
      preludeSource('bad-prelude', ['sdf3d', 'totally-made-up']),
      ...inlineCatalog.all(),
    ]);
    expect(() => assemblePatch(patchOf(['bad-prelude']), catalog)).toThrow(
      /unknown prelude "totally-made-up"/,
    );
  });

  it('prelude emission stays deterministic', () => {
    const patch = patchOf(['sdfCube', 'sdfTunnel']);
    expect(assemblePatch(patch, inlineCatalog).fragSrc).toBe(
      assemblePatch(patch, inlineCatalog).fragSrc,
    );
  });
});
