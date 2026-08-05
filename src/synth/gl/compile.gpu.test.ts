/**
 * GPU compile/link smoke test for assemblePatch output.
 *
 * Covers every inline generator solo and linear source×{field,modifier,material}
 * combinations. Playwright + Chromium; skip with visible reason if browser unavailable.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';
import { FULLSCREEN_VERT } from '../../render/glutil';
import { assemblePatch } from './assemble';
import { inlineCatalog } from '../generators';
import type { GeneratorDefinition, VisualOperator, VisualPatch } from '../types';

const executablePath = (globalThis as { process?: { env?: { CHROMIUM_BIN?: string } } }).process
  ?.env?.CHROMIUM_BIN;
const launchOptions = {
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle'],
  ...(executablePath ? { executablePath } : {}),
};

function paramsFromDef(def: GeneratorDefinition): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const p of def.parameters) {
    out[p.id] = p.default;
  }
  return out;
}

function opFromDef(id: string, def: GeneratorDefinition): VisualOperator {
  return {
    id,
    generatorId: def.id,
    generatorVersion: def.version,
    parameters: paramsFromDef(def),
  };
}

function basePatch(operators: VisualOperator[], seed = 'gpu-compile-seed'): VisualPatch {
  return {
    schemaVersion: 1,
    seed,
    operators,
    routes: [],
    palette: { mode: 'mono', hueOffset: 0, saturation: 80, lightness: 55 },
    composition: { symmetry: 4, scale: 1, speed: 1 },
    qualityTier: 'medium',
  };
}

function requireGen(id: string) {
  const g = inlineCatalog.get(id);
  if (!g) throw new Error(`catalog missing generator "${id}"`);
  return g;
}

/** Classify for patch construction (mirrors assemble roleOf). */
function roleOf(
  def: GeneratorDefinition,
): 'source' | 'field' | 'mod_coord' | 'mod_value' | 'material' {
  if (def.category === 'source') return 'source';
  if (def.category === 'field') return 'field';
  if (def.category === 'material') return 'material';
  if (def.category === 'modifier') {
    if (def.output === 'vector') return 'mod_coord';
    if (def.output === 'field') return 'mod_value';
  }
  throw new Error(`unclassifiable generator ${def.id}`);
}

interface NamedPatch {
  label: string;
  patch: VisualPatch;
}

/** Minimal valid patch that includes the given generator. */
function soloPatchFor(genId: string): NamedPatch {
  const g = requireGen(genId);
  const role = roleOf(g.def);
  const grid = requireGen('grid');
  const neon = requireGen('neon');

  switch (role) {
    case 'source':
      return {
        label: `solo/source:${genId}`,
        patch: basePatch([opFromDef('src0', g.def), opFromDef('mat0', neon.def)]),
      };
    case 'field':
      return {
        label: `solo/field:${genId}`,
        patch: basePatch([
          opFromDef('src0', grid.def),
          opFromDef('fld0', g.def),
          opFromDef('mat0', neon.def),
        ]),
      };
    case 'mod_coord':
      return {
        label: `solo/mod_coord:${genId}`,
        patch: basePatch([
          opFromDef('mod0', g.def),
          opFromDef('src0', grid.def),
          opFromDef('mat0', neon.def),
        ]),
      };
    case 'mod_value':
      return {
        label: `solo/mod_value:${genId}`,
        patch: basePatch([
          opFromDef('src0', grid.def),
          opFromDef('mod0', g.def),
          opFromDef('mat0', neon.def),
        ]),
      };
    case 'material':
      return {
        label: `solo/material:${genId}`,
        patch: basePatch([opFromDef('src0', grid.def), opFromDef('mat0', g.def)]),
      };
  }
}

/** Linear combination patches: each source × (each field | each mod | each material). */
function combinationPatches(): NamedPatch[] {
  const all = inlineCatalog.all();
  const sources = all.filter((g) => roleOf(g.def) === 'source');
  const fields = all.filter((g) => roleOf(g.def) === 'field');
  const mods = all.filter((g) => {
    const r = roleOf(g.def);
    return r === 'mod_coord' || r === 'mod_value';
  });
  const materials = all.filter((g) => roleOf(g.def) === 'material');
  const neon = requireGen('neon');

  const out: NamedPatch[] = [];

  for (const src of sources) {
    for (const fld of fields) {
      out.push({
        label: `combo/source:${src.def.id}+field:${fld.def.id}+material:neon`,
        patch: basePatch([
          opFromDef('src0', src.def),
          opFromDef('fld0', fld.def),
          opFromDef('mat0', neon.def),
        ]),
      });
    }
    for (const mod of mods) {
      const r = roleOf(mod.def);
      out.push({
        label: `combo/source:${src.def.id}+${r}:${mod.def.id}+material:neon`,
        patch: basePatch([
          opFromDef('mod0', mod.def),
          opFromDef('src0', src.def),
          opFromDef('mat0', neon.def),
        ]),
      });
    }
    for (const mat of materials) {
      out.push({
        label: `combo/source:${src.def.id}+material:${mat.def.id}`,
        patch: basePatch([opFromDef('src0', src.def), opFromDef('mat0', mat.def)]),
      });
    }
  }

  return out;
}

function buildAllPatches(): NamedPatch[] {
  const solos = inlineCatalog.all().map((g) => soloPatchFor(g.def.id));
  return [...solos, ...combinationPatches()];
}

async function compileInBrowser(
  page: Page,
  vertSrc: string,
  fragSrc: string,
): Promise<{ ok: true } | { ok: false; log: string }> {
  return page.evaluate(
    ({ vertSrc, fragSrc }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      const gl = canvas.getContext('webgl2', {
        antialias: false,
        depth: false,
        stencil: false,
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
      });
      if (!gl) {
        return { ok: false as const, log: 'WebGL2 context unavailable' };
      }

      function compileShader(g: WebGL2RenderingContext, type: number, src: string): string | null {
        const sh = g.createShader(type);
        if (!sh) return 'Failed to create shader';
        g.shaderSource(sh, src);
        g.compileShader(sh);
        if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) {
          const log = g.getShaderInfoLog(sh) ?? '(no info log)';
          g.deleteShader(sh);
          const kind = type === g.VERTEX_SHADER ? 'vertex' : 'fragment';
          return `GLSL ${kind} shader compile failed:\n${log}\n--- source ---\n${src}`;
        }
        (g as unknown as { __lastShader?: WebGLShader }).__lastShader = sh;
        return null;
      }

      const vErr = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
      if (vErr) return { ok: false as const, log: vErr };
      const vs = (gl as unknown as { __lastShader: WebGLShader }).__lastShader;

      const fErr = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
      if (fErr) {
        gl.deleteShader(vs);
        return { ok: false as const, log: fErr };
      }
      const fs = (gl as unknown as { __lastShader: WebGLShader }).__lastShader;

      const prog = gl.createProgram();
      if (!prog) {
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        return { ok: false as const, log: 'Failed to create program' };
      }
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(prog) ?? '(no info log)';
        gl.deleteProgram(prog);
        return { ok: false as const, log: `GLSL program link failed:\n${log}` };
      }
      gl.deleteProgram(prog);
      return { ok: true as const };
    },
    { vertSrc, fragSrc },
  );
}

let browser: Browser | null = null;
let page: Page | null = null;
let browserLaunchError: unknown = null;

try {
  browser = await chromium.launch(launchOptions);
  page = await browser.newPage();
} catch (e) {
  browserLaunchError = e;
  console.warn(
    '[compile.gpu.test] browser unavailable — GPU compile tests will be skipped:',
    e instanceof Error ? e.message : e,
  );
}

const ALL_PATCHES = buildAllPatches();
const PATCH_COUNT = ALL_PATCHES.length;

describe('synth/gl assemblePatch GPU compile', () => {
  if (!browser || !page) {
    it.skip(`browser unavailable — GPU compile tests skipped${
      browserLaunchError instanceof Error ? `: ${browserLaunchError.message}` : ''
    }`, () => {});
    return;
  }

  const br = browser;
  const pg = page;

  afterAll(async () => {
    await pg.close().catch(() => {});
    await br.close().catch(() => {});
  });

  // 49 generators → hundreds of combination patches; default 5s testTimeout is too short.
  const compileTimeoutMs = 120_000;

  it(
    `compiles ${PATCH_COUNT} patches covering all generators`,
    async () => {
      expect(PATCH_COUNT).toBeGreaterThan(0);
      // catalog size sanity: 49 generators
      expect(inlineCatalog.all().length).toBe(49);
      console.log(`[compile.gpu.test] verifying ${PATCH_COUNT} patches`);

      const failures: string[] = [];

      for (const { label, patch } of ALL_PATCHES) {
        let fragSrc: string;
        try {
          fragSrc = assemblePatch(patch, inlineCatalog).fragSrc;
        } catch (e) {
          failures.push(
            `${label}: assemblePatch threw: ${e instanceof Error ? e.message : String(e)}`,
          );
          continue;
        }
        const result = await compileInBrowser(pg, FULLSCREEN_VERT, fragSrc);
        if (!result.ok) {
          failures.push(`${label}:\n${result.log}`);
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length}/${PATCH_COUNT} patch(es) failed GPU compile/link:\n\n` +
            failures.join('\n\n==========\n\n'),
        );
      }

      expect(failures.length).toBe(0);
      console.log(`[compile.gpu.test] all ${PATCH_COUNT} patches compiled and linked`);
    },
    compileTimeoutMs,
  );
});
