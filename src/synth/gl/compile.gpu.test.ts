/**
 * GPU compile/link smoke test for assemblePatch output.
 *
 * Playwright + Chromium; skip with visible reason if browser unavailable.
 * Follows rng.gpu.test.ts patterns.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';
import { FULLSCREEN_VERT } from '../../render/glutil';
import { assemblePatch } from './assemble';
import { inlineCatalog } from '../generators';
import type { VisualPatch } from '../types';

const executablePath = (globalThis as { process?: { env?: { CHROMIUM_BIN?: string } } }).process
  ?.env?.CHROMIUM_BIN;
const launchOptions = {
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle'],
  ...(executablePath ? { executablePath } : {}),
};

function defaultPatch(seed = 'gpu-compile-seed'): VisualPatch {
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
        // keep shader alive for link; return via side channel is awkward — store on gl temp
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

  it('default grid+noise+mirror+neon patch compiles and links', async () => {
    const { fragSrc } = assemblePatch(defaultPatch(), inlineCatalog);
    const result = await compileInBrowser(pg, FULLSCREEN_VERT, fragSrc);
    if (!result.ok) {
      throw new Error(result.log);
    }
    expect(result.ok).toBe(true);
  });
});
