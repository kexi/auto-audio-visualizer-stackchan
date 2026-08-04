/**
 * CPU (rng.ts) と GPU (rng.glsl.ts via WebGL2) の乱数列 bit-exact 一致テスト。
 *
 * Playwright で Chromium を起動し、FBO + readPixels (RGBA8 に 24bit をパック) で
 * 検証する。ブラウザが起動できない場合はスイートごと skip する（黙って pass しない）。
 */
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';
import { namespaceToU32, rand, seedToU32 } from './rng';
import { RNG_GLSL } from './rng.glsl';

// tsconfig.app は DOM のみ（@types/node 未参照）なので globalThis 経由で読む
const executablePath = (globalThis as { process?: { env?: { CHROMIUM_BIN?: string } } }).process
  ?.env?.CHROMIUM_BIN;
const launchOptions = {
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle'],
  ...(executablePath ? { executablePath } : {}),
};

/** 上位 24bit を整数として取り出す（rand の設計どおり常に整数）。 */
function cpuPacked24(seed: string, namespace: string, index: number): number {
  return Math.round(rand(seed, namespace, index) * 16777216);
}

/**
 * ブラウザ内で WebGL2 FBO に RNG を描画し、index 0..count-1 の 24bit 値を返す。
 * Node 側で seed/ns の u32 と GLSL 文字列を渡す。
 */
async function gpuPacked24Range(
  page: Page,
  seed: string,
  namespace: string,
  count: number,
): Promise<number[]> {
  const seedU = seedToU32(seed);
  const nsU = namespaceToU32(namespace);

  return page.evaluate(
    ({ rngGlsl, seedU, nsU, count }) => {
      const canvas = document.createElement('canvas');
      canvas.width = count;
      canvas.height = 1;
      const gl = canvas.getContext('webgl2', {
        antialias: false,
        depth: false,
        stencil: false,
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
      });
      if (!gl) {
        throw new Error('WebGL2 context unavailable');
      }

      gl.disable(gl.DITHER);
      gl.disable(gl.BLEND);
      gl.viewport(0, 0, count, 1);

      const vertSrc = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

      const fragSrc = `#version 300 es
precision highp float;
precision highp int;
${rngGlsl}
uniform uint uSeed;
uniform uint uNs;
out vec4 fragColor;
void main() {
  uint index = uint(gl_FragCoord.x);
  uint h = synthHashCombine(synthHashCombine(uSeed, uNs), index);
  uint v = h >> 8u;
  float r = float((v >> 16u) & 255u) / 255.0;
  float g = float((v >> 8u) & 255u) / 255.0;
  float b = float(v & 255u) / 255.0;
  fragColor = vec4(r, g, b, 1.0);
}
`;

      function compileShader(g: WebGL2RenderingContext, type: number, src: string): WebGLShader {
        const sh = g.createShader(type);
        if (!sh) throw new Error('Failed to create shader');
        g.shaderSource(sh, src);
        g.compileShader(sh);
        if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) {
          const log = g.getShaderInfoLog(sh) ?? '(no info log)';
          g.deleteShader(sh);
          throw new Error(`Shader compile failed:\n${log}`);
        }
        return sh;
      }

      const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
      const prog = gl.createProgram();
      if (!prog) throw new Error('Failed to create program');
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(prog) ?? '(no info log)';
        gl.deleteProgram(prog);
        throw new Error(`Program link failed:\n${log}`);
      }

      const tex = gl.createTexture();
      if (!tex) throw new Error('Failed to create texture');
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, count, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const fbo = gl.createFramebuffer();
      if (!fbo) throw new Error('Failed to create framebuffer');
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
      }

      const vao = gl.createVertexArray();
      if (!vao) throw new Error('Failed to create VAO');
      gl.bindVertexArray(vao);

      gl.useProgram(prog);
      const uSeedLoc = gl.getUniformLocation(prog, 'uSeed');
      const uNsLoc = gl.getUniformLocation(prog, 'uNs');
      if (!uSeedLoc || !uNsLoc) {
        throw new Error('Uniform locations not found');
      }
      // u32 は >>> 0 で符号なし 32bit に揃えてから渡す
      gl.uniform1ui(uSeedLoc, seedU >>> 0);
      gl.uniform1ui(uNsLoc, nsU >>> 0);

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      const pixels = new Uint8Array(count * 4);
      gl.readPixels(0, 0, count, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      const values: number[] = [];
      for (let i = 0; i < count; i++) {
        const r = pixels[i * 4]!;
        const g = pixels[i * 4 + 1]!;
        const b = pixels[i * 4 + 2]!;
        values.push((r << 16) | (g << 8) | b);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteVertexArray(vao);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      gl.deleteProgram(prog);

      return values;
    },
    { rngGlsl: RNG_GLSL, seedU, nsU, count },
  );
}

function assertRangeMatches(seed: string, namespace: string, gpu: number[]): void {
  for (let i = 0; i < gpu.length; i++) {
    const expected = cpuPacked24(seed, namespace, i);
    const actual = gpu[i]!;
    expect(actual, `mismatch at index ${i} seed=${seed} ns=${namespace}`).toBe(expected);
  }
}

// ブラウザ起動可否をスイート定義前に判定する（失敗時は skip を可視化）
let browser: Browser | null = null;
let page: Page | null = null;
let browserLaunchError: unknown = null;

try {
  browser = await chromium.launch(launchOptions);
  page = await browser.newPage();
} catch (e) {
  browserLaunchError = e;
  console.warn(
    '[rng.gpu.test] browser unavailable — GPU parity tests will be skipped:',
    e instanceof Error ? e.message : e,
  );
}

describe('synth/rng GPU parity', () => {
  if (!browser || !page) {
    it.skip(`browser unavailable — GPU parity tests skipped${
      browserLaunchError instanceof Error ? `: ${browserLaunchError.message}` : ''
    }`, () => {});
    return;
  }

  // クロージャにキャプチャ（narrowing 後の参照を固定）
  const br = browser;
  const pg = page;

  afterAll(async () => {
    await pg.close().catch(() => {});
    await br.close().catch(() => {});
  });

  it('単一 (seed, namespace) で indices 0..255 が CPU と一致する', async () => {
    const seed = 'neon-tiger-042';
    const namespace = 'generator:grid';
    const gpu = await gpuPacked24Range(pg, seed, namespace, 256);
    expect(gpu).toHaveLength(256);
    assertRangeMatches(seed, namespace, gpu);
  });

  it('異なる namespace でも CPU と一致する', async () => {
    const seed = 'shared-seed';
    const namespaces = ['generator:grid', 'generator:particles', 'layer:bloom'];
    for (const namespace of namespaces) {
      const gpu = await gpuPacked24Range(pg, seed, namespace, 64);
      assertRangeMatches(seed, namespace, gpu);
    }
  });

  it('異なる seed でも CPU と一致する', async () => {
    const seeds = ['neon-tiger-042', 'void-whisper-7', 'alpha'];
    const namespace = 'generator:grid';
    for (const seed of seeds) {
      const gpu = await gpuPacked24Range(pg, seed, namespace, 64);
      assertRangeMatches(seed, namespace, gpu);
    }
  });

  it('golden 値が GPU でも一致する', async () => {
    const golden: Array<{ seed: string; namespace: string; index: number }> = [
      { seed: 'neon-tiger-042', namespace: 'generator:grid', index: 0 },
      { seed: 'neon-tiger-042', namespace: 'generator:grid', index: 1 },
      { seed: 'neon-tiger-042', namespace: 'generator:grid', index: 42 },
      { seed: 'neon-tiger-042', namespace: 'generator:particles', index: 0 },
      { seed: 'void-whisper-7', namespace: 'generator:grid', index: 0 },
      { seed: 'void-whisper-7', namespace: 'layer:bloom', index: 3 },
      { seed: 'alpha', namespace: 'beta', index: 0 },
      { seed: 'alpha', namespace: 'beta', index: 100 },
    ];

    // (seed, namespace) ごとに最大 index+1 まで一括取得
    const groups = new Map<string, { seed: string; namespace: string; maxIndex: number }>();
    for (const g of golden) {
      const key = `${g.seed}\0${g.namespace}`;
      const prev = groups.get(key);
      if (!prev || g.index > prev.maxIndex) {
        groups.set(key, { seed: g.seed, namespace: g.namespace, maxIndex: g.index });
      }
    }

    const cache = new Map<string, number[]>();
    for (const [key, { seed, namespace, maxIndex }] of groups) {
      cache.set(key, await gpuPacked24Range(pg, seed, namespace, maxIndex + 1));
    }

    for (const { seed, namespace, index } of golden) {
      const key = `${seed}\0${namespace}`;
      const gpu = cache.get(key)!;
      const actual = gpu[index]!;
      const expected = cpuPacked24(seed, namespace, index);
      expect(actual, `golden mismatch seed=${seed} ns=${namespace} index=${index}`).toBe(expected);
    }
  });
});
