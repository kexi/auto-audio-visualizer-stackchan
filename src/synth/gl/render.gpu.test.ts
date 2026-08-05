/**
 * GPU render smoke test for assemblePatch output.
 *
 * Verifies that assembled fullscreen shaders actually draw non-empty,
 * non-uniform pixels (not merely that GLSL compiles).
 *
 * SCOPE: Only Source×Material combinations are covered.
 * Field and Modifier generators are intentionally OUT OF SCOPE because
 * operators like `threshold` can legitimately render fully black / empty
 * depending on settings; requiring non-empty alpha or non-uniform pixels
 * would be inappropriate for them.
 *
 * Playwright + Chromium; skip with visible reason if browser unavailable.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';
import { FULLSCREEN_VERT } from '../../render/glutil';
import { assemblePatch, SEED_UNIFORM, type AssembledShader } from './assemble';
import { inlineCatalog } from '../generators';
import { namespaceToU32, seedToU32 } from '../rng';
import type { GeneratorDefinition, VisualOperator, VisualPatch } from '../types';

// 64 undersamples default grid lines (cells=8, thickness=0.08) — pixel centers
// miss thin strokes and read fully transparent; 256 leaves a safe sampling margin.
const SIZE = 256;
// ~1/10 of 1080p after a half-res degradation step; thin lines without fwidth AA vanish here.
const SIZE_LOW = 96;
const SEED = 'gpu-render-seed';

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

function basePatch(operators: VisualOperator[], seed = SEED): VisualPatch {
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

interface NamedPatch {
  label: string;
  patch: VisualPatch;
}

/**
 * Source×Material only. Field/Modifier patches are out of scope (see file header).
 */
function sourceNeonPatches(): NamedPatch[] {
  const sources = inlineCatalog.all().filter((g) => g.def.category === 'source');
  const neon = requireGen('neon');
  return sources.map((src) => ({
    label: `source:${src.def.id}+material:neon`,
    patch: basePatch([opFromDef('src0', src.def), opFromDef('mat0', neon.def)]),
  }));
}

/**
 * grid×each Material. Field/Modifier patches are out of scope (see file header).
 */
function gridMaterialPatches(): NamedPatch[] {
  const materials = inlineCatalog.all().filter((g) => g.def.category === 'material');
  const grid = requireGen('grid');
  return materials.map((mat) => ({
    label: `source:grid+material:${mat.def.id}`,
    patch: basePatch([opFromDef('src0', grid.def), opFromDef('mat0', mat.def)]),
  }));
}

/** Unique patches from the source and material sets (dedupe by label). */
function allRenderPatches(): NamedPatch[] {
  const byLabel = new Map<string, NamedPatch>();
  for (const p of [...sourceNeonPatches(), ...gridMaterialPatches()]) {
    byLabel.set(p.label, p);
  }
  return [...byLabel.values()];
}

function hasNonZeroAlpha(pixels: number[]): boolean {
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! !== 0) return true;
  return false;
}

/** Number of pixels with any alpha at all. */
function alphaCount(pixels: number[]): number {
  let n = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! !== 0) n++;
  return n;
}

function isUniform(pixels: number[]): boolean {
  if (pixels.length < 4) return true;
  const r0 = pixels[0]!,
    g0 = pixels[1]!,
    b0 = pixels[2]!,
    a0 = pixels[3]!;
  for (let i = 4; i < pixels.length; i += 4) {
    if (pixels[i] !== r0 || pixels[i + 1] !== g0 || pixels[i + 2] !== b0 || pixels[i + 3] !== a0)
      return false;
  }
  return true;
}

type UniformSpec =
  | { name: string; kind: '1f'; value: number }
  | { name: string; kind: '2f'; value: [number, number] }
  | { name: string; kind: '1i'; value: number }
  | { name: string; kind: '1ui'; value: number };

/**
 * A texture slot to fill before drawing.
 *
 * `pattern` builds a procedural image in-browser (no fixture files, so the test
 * stays hermetic and deterministic); `transparent` is the 1×1 stand-in the scene
 * binds when a Patch references an image nobody has loaded; `firstRows` is
 * opaque only in the rows uploaded first (t≈0) and pins the sampling
 * orientation.
 */
interface TextureSpec {
  name: string;
  sizeName: string;
  unit: number;
  kind: 'pattern' | 'transparent' | 'firstRows';
}

/** Size of the procedural test image. Large enough to survive the 96px pass. */
const DUMMY_IMAGE_SIZE = 128;

/** Bindings for every declared slot, filled with the given kind of image. */
function textureSpecs(
  assembled: AssembledShader,
  kind: TextureSpec['kind'] = 'pattern',
): TextureSpec[] {
  return assembled.textures.map((t, unit) => ({
    name: t.name,
    sizeName: t.sizeName,
    unit,
    kind,
  }));
}

/**
 * Build serializable uniform values on the Node side (mirrors semanticSynth draw).
 * Defaults come from op.parameters (already filled from generator defs).
 */
function buildUniformSpecs(
  patch: VisualPatch,
  assembled: AssembledShader,
  size: number = SIZE,
): UniformSpec[] {
  const specs: UniformSpec[] = [
    { name: 'uTime', kind: '1f', value: 1.0 },
    { name: 'uRes', kind: '2f', value: [size, size] },
    { name: 'uBass', kind: '1f', value: 0.5 },
    { name: 'uMid', kind: '1f', value: 0.5 },
    { name: 'uTreble', kind: '1f', value: 0.5 },
    { name: 'uLevel', kind: '1f', value: 0.5 },
    { name: 'uBeat', kind: '1f', value: 0.5 },
    { name: 'uFade', kind: '1f', value: 1.0 },
    { name: SEED_UNIFORM, kind: '1ui', value: seedToU32(patch.seed) >>> 0 },
  ];

  for (const { opId, name } of assembled.nsUniforms) {
    specs.push({ name, kind: '1ui', value: namespaceToU32(`op:${opId}`) >>> 0 });
  }

  for (const { opId, paramId, name } of assembled.uniforms) {
    const op = patch.operators.find((o) => o.id === opId);
    if (!op) continue;
    const gen = inlineCatalog.get(op.generatorId);
    if (!gen) continue;
    const paramDef = gen.def.parameters.find((p) => p.id === paramId);
    if (!paramDef) continue;
    const raw = op.parameters[paramId] ?? paramDef.default;

    switch (paramDef.kind) {
      case 'number':
        specs.push({
          name,
          kind: '1f',
          value: typeof raw === 'number' ? raw : Number(raw),
        });
        break;
      case 'int':
        specs.push({
          name,
          kind: '1i',
          value: typeof raw === 'number' ? raw | 0 : Number(raw) | 0,
        });
        break;
      case 'bool':
        specs.push({ name, kind: '1i', value: raw ? 1 : 0 });
        break;
      case 'enum': {
        const opts = paramDef.options ?? [];
        const idx = typeof raw === 'string' ? opts.indexOf(raw) : Number(raw) | 0;
        specs.push({ name, kind: '1i', value: idx < 0 ? 0 : idx });
        break;
      }
    }
  }

  return specs;
}

async function renderInBrowser(
  page: Page,
  vertSrc: string,
  fragSrc: string,
  uniforms: UniformSpec[],
  size: number,
  textures: TextureSpec[] = [],
  imageSize: number = DUMMY_IMAGE_SIZE,
): Promise<{ ok: true; pixels: number[] } | { ok: false; log: string }> {
  return page.evaluate(
    ({ vertSrc, fragSrc, uniforms, size, textures, imageSize }) => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
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

      gl.disable(gl.DITHER);
      gl.disable(gl.BLEND);
      gl.viewport(0, 0, size, size);

      function compileShader(g: WebGL2RenderingContext, type: number, src: string): string | null {
        const sh = g.createShader(type);
        if (!sh) return 'Failed to create shader';
        g.shaderSource(sh, src);
        g.compileShader(sh);
        if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) {
          const log = g.getShaderInfoLog(sh) ?? '(no info log)';
          g.deleteShader(sh);
          const kind = type === g.VERTEX_SHADER ? 'vertex' : 'fragment';
          return `GLSL ${kind} shader compile failed:\n${log}`;
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

      const tex = gl.createTexture();
      if (!tex) {
        gl.deleteProgram(prog);
        return { ok: false as const, log: 'Failed to create texture' };
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const fbo = gl.createFramebuffer();
      if (!fbo) {
        gl.deleteTexture(tex);
        gl.deleteProgram(prog);
        return { ok: false as const, log: 'Failed to create framebuffer' };
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(tex);
        gl.deleteProgram(prog);
        return { ok: false as const, log: `Framebuffer incomplete: 0x${status.toString(16)}` };
      }

      const vao = gl.createVertexArray();
      if (!vao) {
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(tex);
        gl.deleteProgram(prog);
        return { ok: false as const, log: 'Failed to create VAO' };
      }
      gl.bindVertexArray(vao);
      gl.useProgram(prog);

      // --- texture slots ---
      /** Opaque disc over a checker, transparent outside — luminance AND alpha vary. */
      function patternImage(n: number): ImageData {
        const data = new Uint8ClampedArray(n * n * 4);
        const cell = Math.max(1, n >> 3);
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            const i = (y * n + x) * 4;
            const dx = (x + 0.5) / n - 0.5;
            const dy = (y + 0.5) / n - 0.5;
            const inside = dx * dx + dy * dy < 0.45 * 0.45;
            const checker = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
            const level = checker ? 255 : 140;
            data[i] = inside ? level : 0;
            data[i + 1] = inside ? level : 0;
            data[i + 2] = inside ? level : 0;
            data[i + 3] = inside ? 255 : 0;
          }
        }
        return new ImageData(data, n, n);
      }

      /** Opaque white in the rows uploaded first (t≈0), transparent after. */
      function firstRowsImage(n: number): ImageData {
        const data = new Uint8ClampedArray(n * n * 4);
        for (let y = 0; y < n; y++) {
          const lit = y < n / 2;
          for (let x = 0; x < n; x++) {
            const i = (y * n + x) * 4;
            data[i] = lit ? 255 : 0;
            data[i + 1] = lit ? 255 : 0;
            data[i + 2] = lit ? 255 : 0;
            data[i + 3] = lit ? 255 : 0;
          }
        }
        return new ImageData(data, n, n);
      }

      const createdTextures: WebGLTexture[] = [];
      for (const t of textures) {
        const tex = gl.createTexture();
        if (!tex) continue;
        createdTextures.push(tex);
        gl.activeTexture(gl.TEXTURE0 + t.unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        // UNPACK_FLIP_Y_WEBGL stays untouched, exactly like semanticSynth's
        // uploader — the image store is what owns the orientation.
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        if (t.kind === 'transparent') {
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            1,
            1,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            new Uint8Array([0, 0, 0, 0]),
          );
        } else {
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            t.kind === 'firstRows' ? firstRowsImage(imageSize) : patternImage(imageSize),
          );
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        const texLoc = gl.getUniformLocation(prog, t.name);
        if (texLoc) gl.uniform1i(texLoc, t.unit);
        const sizeLoc = gl.getUniformLocation(prog, t.sizeName);
        const px = t.kind === 'transparent' ? 1 : imageSize;
        if (sizeLoc) gl.uniform2f(sizeLoc, px, px);
      }
      gl.activeTexture(gl.TEXTURE0);

      for (const u of uniforms) {
        const loc = gl.getUniformLocation(prog, u.name);
        if (!loc) continue;
        switch (u.kind) {
          case '1f':
            gl.uniform1f(loc, u.value);
            break;
          case '2f':
            gl.uniform2f(loc, u.value[0], u.value[1]);
            break;
          case '1i':
            gl.uniform1i(loc, u.value);
            break;
          case '1ui':
            gl.uniform1ui(loc, u.value >>> 0);
            break;
        }
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      const buf = new Uint8Array(size * size * 4);
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, buf);

      gl.deleteVertexArray(vao);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      for (const t of createdTextures) gl.deleteTexture(t);
      gl.deleteProgram(prog);

      return { ok: true as const, pixels: Array.from(buf) };
    },
    { vertSrc, fragSrc, uniforms, size, textures, imageSize },
  );
}

async function renderPatch(
  page: Page,
  { patch }: NamedPatch,
  size: number = SIZE,
  textureKind: TextureSpec['kind'] = 'pattern',
): Promise<{ ok: true; pixels: number[] } | { ok: false; log: string }> {
  let assembled: AssembledShader;
  try {
    assembled = assemblePatch(patch, inlineCatalog);
  } catch (e) {
    return {
      ok: false,
      log: `assemblePatch threw: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const uniforms = buildUniformSpecs(patch, assembled, size);
  const textures = textureSpecs(assembled, textureKind);
  try {
    return await renderInBrowser(
      page,
      FULLSCREEN_VERT,
      assembled.fragSrc,
      uniforms,
      size,
      textures,
    );
  } catch (e) {
    return {
      ok: false,
      log: `GPU error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
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
    '[render.gpu.test] browser unavailable — GPU render tests will be skipped:',
    e instanceof Error ? e.message : e,
  );
}

const SOURCE_NEON = sourceNeonPatches();
const GRID_MATERIALS = gridMaterialPatches();
const ALL_RENDER = allRenderPatches();

describe('synth/gl assemblePatch GPU render', () => {
  if (!browser || !page) {
    it.skip(`browser unavailable — GPU render tests skipped${
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

  // SIZE=256 + many source×material patches makes multi-patch WebGL/readPixels slow.
  // 100 generators → unique source/material patches; 60s is too tight.
  const renderTimeoutMs = 180_000;

  it(
    `all Sources draw something (${SOURCE_NEON.length} patches)`,
    async () => {
      expect(SOURCE_NEON.length).toBeGreaterThan(0);
      console.log(
        `[render.gpu.test] verifying ${SOURCE_NEON.length} source×neon patches for non-zero alpha`,
      );

      const failures: string[] = [];

      for (const named of SOURCE_NEON) {
        const result = await renderPatch(pg, named);
        if (!result.ok) {
          failures.push(`${named.label}: ${result.log}`);
          continue;
        }
        if (!hasNonZeroAlpha(result.pixels)) {
          failures.push(`${named.label}: empty alpha (all pixels alpha=0)`);
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length}/${SOURCE_NEON.length} source patch(es) failed non-empty alpha:\n\n` +
            failures.join('\n'),
        );
      }

      console.log(
        `[render.gpu.test] all ${SOURCE_NEON.length} source×neon patches have non-zero alpha`,
      );
    },
    renderTimeoutMs,
  );

  it(
    `all Materials draw something (${GRID_MATERIALS.length} patches)`,
    async () => {
      expect(GRID_MATERIALS.length).toBeGreaterThan(0);
      console.log(
        `[render.gpu.test] verifying ${GRID_MATERIALS.length} grid×material patches for non-zero alpha`,
      );

      const failures: string[] = [];

      for (const named of GRID_MATERIALS) {
        const result = await renderPatch(pg, named);
        if (!result.ok) {
          failures.push(`${named.label}: ${result.log}`);
          continue;
        }
        if (!hasNonZeroAlpha(result.pixels)) {
          failures.push(`${named.label}: empty alpha (all pixels alpha=0)`);
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length}/${GRID_MATERIALS.length} material patch(es) failed non-empty alpha:\n\n` +
            failures.join('\n'),
        );
      }

      console.log(
        `[render.gpu.test] all ${GRID_MATERIALS.length} grid×material patches have non-zero alpha`,
      );
    },
    renderTimeoutMs,
  );

  it(
    `output is non-uniform (${ALL_RENDER.length} unique patches)`,
    async () => {
      expect(ALL_RENDER.length).toBeGreaterThan(0);
      console.log(
        `[render.gpu.test] verifying ${ALL_RENDER.length} unique patches for non-uniform pixels`,
      );

      const failures: string[] = [];

      for (const named of ALL_RENDER) {
        const result = await renderPatch(pg, named);
        if (!result.ok) {
          failures.push(`${named.label}: ${result.log}`);
          continue;
        }
        if (isUniform(result.pixels)) {
          failures.push(`${named.label}: uniform output (all pixels identical RGBA)`);
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length}/${ALL_RENDER.length} patch(es) failed non-uniform check:\n\n` +
            failures.join('\n'),
        );
      }

      console.log(`[render.gpu.test] all ${ALL_RENDER.length} unique patches are non-uniform`);
    },
    renderTimeoutMs,
  );

  it(
    'stamp draws the bound image, and nothing at all without one',
    async () => {
      const stamp = requireGen('stamp');
      const neon = requireGen('neon');
      const named: NamedPatch = {
        label: 'source:stamp+material:neon',
        patch: {
          ...basePatch([opFromDef('src0', stamp.def), opFromDef('mat0', neon.def)]),
          images: { 'src0.image': { name: 'procedural.png', hash: 'test-pattern' } },
        },
      };

      // 1. a real (procedurally generated) image → visible, structured output
      const withImage = await renderPatch(pg, named);
      if (!withImage.ok) throw new Error(`stamp with image failed: ${withImage.log}`);
      expect(hasNonZeroAlpha(withImage.pixels), 'stamp×neon drew nothing').toBe(true);
      expect(isUniform(withImage.pixels), 'stamp×neon output is a flat fill').toBe(false);

      // 2. the scene's fallback (1×1 transparent) → v = 0, an empty frame
      const withoutImage = await renderPatch(pg, named, SIZE, 'transparent');
      if (!withoutImage.ok) throw new Error(`stamp without image failed: ${withoutImage.log}`);
      expect(
        hasNonZeroAlpha(withoutImage.pixels),
        'a missing image must render empty, not opaque',
      ).toBe(false);

      // 3. orientation. The image store hands over bottom-row-first pixels, so
      //    the rows uploaded first (t≈0) must land at the bottom of the frame.
      //    readPixels also starts at the bottom row, so the lit rows come first.
      //    Quarters, not halves: LINEAR filtering bleeds a row or two across the
      //    seam and that is not an orientation bug.
      const oriented = await renderPatch(pg, named, SIZE, 'firstRows');
      if (!oriented.ok) throw new Error(`stamp orientation probe failed: ${oriented.log}`);
      const quarter = (SIZE * SIZE * 4) / 4;
      const bottom = alphaCount(oriented.pixels.slice(0, quarter));
      const top = alphaCount(oriented.pixels.slice(quarter * 3));
      expect(bottom, 'first-uploaded rows must appear at the bottom of the frame').toBeGreaterThan(
        quarter / 4 / 2,
      );
      expect(top, 'the transparent rows must appear at the top of the frame').toBe(0);
    },
    renderTimeoutMs,
  );

  it(
    `low-res (${SIZE_LOW}): all Sources keep non-zero alpha (${SOURCE_NEON.length} patches)`,
    async () => {
      expect(SOURCE_NEON.length).toBeGreaterThan(0);
      console.log(
        `[render.gpu.test] verifying ${SOURCE_NEON.length} source×neon patches at ${SIZE_LOW}px for non-zero alpha`,
      );

      const failures: string[] = [];

      for (const named of SOURCE_NEON) {
        const result = await renderPatch(pg, named, SIZE_LOW);
        if (!result.ok) {
          failures.push(`${named.label}: ${result.log}`);
          continue;
        }
        if (!hasNonZeroAlpha(result.pixels)) {
          failures.push(`${named.label}: empty alpha (all pixels alpha=0) at ${SIZE_LOW}px`);
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length}/${SOURCE_NEON.length} source patch(es) failed low-res non-empty alpha:\n\n` +
            failures.join('\n'),
        );
      }

      console.log(
        `[render.gpu.test] all ${SOURCE_NEON.length} source×neon patches have non-zero alpha at ${SIZE_LOW}px`,
      );
    },
    renderTimeoutMs,
  );
});
