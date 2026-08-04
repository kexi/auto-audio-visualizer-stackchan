import { describe, expect, it } from 'vitest';
import { assemblePatch, nsUniformName, SEED_UNIFORM, uniformName } from './assemble';
import { inlineCatalog } from '../generators';
import type { VisualPatch } from '../types';

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
