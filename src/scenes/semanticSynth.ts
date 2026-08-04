import type { GlScene, GlSceneContext } from './types';
import {
  compileProgram,
  createEmptyVao,
  drawFullscreen,
  FULLSCREEN_VERT,
  Uniforms,
} from '../render/glutil';
import { derivePatch } from '../synth/derive';
import { assemblePatch, SEED_UNIFORM, type AssembledShader } from '../synth/gl/assemble';
import { inlineCatalog } from '../synth/generators';
import {
  applyModulation,
  createModulationEngine,
  type ModulationEngine,
} from '../synth/modulation';
import { namespaceToU32, seedToU32 } from '../synth/rng';
import { serializePatch } from '../synth/schema';
import type { VisualPatch } from '../synth/types';

/**
 * Semantic Synth — Phase 1 demo scene.
 * Derives a Patch from the variation seed, assembles GLSL, modulates params
 * from audio, and caches compiled programs (LRU, async when available).
 */

const CACHE_LIMIT = 8;

type CacheEntry = {
  key: string;
  prog: WebGLProgram;
  uni: Uniforms;
};

type ActiveState = {
  seed: string;
  key: string;
  patch: VisualPatch;
  assembled: AssembledShader;
  prog: WebGLProgram;
  uni: Uniforms;
  modEngine: ModulationEngine;
};

type PendingCompile = {
  seed: string;
  key: string;
  patch: VisualPatch;
  assembled: AssembledShader;
  prog: WebGLProgram;
  vs: WebGLShader;
  fs: WebGLShader;
};

let vao: WebGLVertexArrayObject | null = null;
let desiredSeed: string | null = null;
let current: ActiveState | null = null;
let pending: PendingCompile | null = null;
/** LRU: oldest at index 0, newest at end. */
const programCache: CacheEntry[] = [];
let parallelCompile: { COMPLETION_STATUS_KHR: number } | null | undefined;

function getParallelCompileExt(
  gl: WebGL2RenderingContext,
): { COMPLETION_STATUS_KHR: number } | null {
  if (parallelCompile !== undefined) return parallelCompile;
  const ext = gl.getExtension('KHR_parallel_shader_compile') as {
    COMPLETION_STATUS_KHR: number;
  } | null;
  parallelCompile = ext;
  return ext;
}

function setParamUniform(
  gl: WebGL2RenderingContext,
  u: Uniforms,
  name: string,
  kind: 'number' | 'int' | 'bool' | 'enum',
  value: number | string | boolean,
  options?: string[],
): void {
  switch (kind) {
    case 'number':
      u.f1(name, typeof value === 'number' ? value : Number(value));
      break;
    case 'int':
      u.i1(name, typeof value === 'number' ? value | 0 : Number(value) | 0);
      break;
    case 'bool':
      u.i1(name, value ? 1 : 0);
      break;
    case 'enum': {
      const opts = options ?? [];
      const idx = typeof value === 'string' ? opts.indexOf(value) : Number(value) | 0;
      u.i1(name, idx < 0 ? 0 : idx);
      break;
    }
  }
  void gl;
}

function cacheLookup(key: string): CacheEntry | null {
  const idx = programCache.findIndex((e) => e.key === key);
  if (idx < 0) return null;
  const [entry] = programCache.splice(idx, 1);
  if (!entry) return null;
  programCache.push(entry);
  return entry;
}

function cacheInsert(gl: WebGL2RenderingContext, entry: CacheEntry): void {
  const existing = programCache.findIndex((e) => e.key === entry.key);
  if (existing >= 0) {
    const old = programCache.splice(existing, 1)[0]!;
    if (old.prog !== entry.prog && old.prog !== current?.prog) {
      gl.deleteProgram(old.prog);
    }
  }
  programCache.push(entry);
  while (programCache.length > CACHE_LIMIT) {
    let victimIdx = -1;
    for (let i = 0; i < programCache.length; i++) {
      if (programCache[i]!.prog !== current?.prog) {
        victimIdx = i;
        break;
      }
    }
    if (victimIdx < 0) break;
    const [victim] = programCache.splice(victimIdx, 1);
    if (victim) gl.deleteProgram(victim.prog);
  }
}

function abandonPending(gl: WebGL2RenderingContext): void {
  if (!pending) return;
  gl.deleteShader(pending.vs);
  gl.deleteShader(pending.fs);
  gl.deleteProgram(pending.prog);
  pending = null;
}

function promote(
  gl: WebGL2RenderingContext,
  seed: string,
  key: string,
  patch: VisualPatch,
  assembled: AssembledShader,
  prog: WebGLProgram,
  uni: Uniforms,
): void {
  cacheInsert(gl, { key, prog, uni });
  current = {
    seed,
    key,
    patch,
    assembled,
    prog,
    uni,
    modEngine: createModulationEngine(patch.routes),
  };
}

function beginCompile(
  gl: WebGL2RenderingContext,
  seed: string,
  key: string,
  patch: VisualPatch,
  assembled: AssembledShader,
): void {
  abandonPending(gl);

  const ext = getParallelCompileExt(gl);
  if (!ext) {
    try {
      const prog = compileProgram(gl, FULLSCREEN_VERT, assembled.fragSrc);
      const uni = new Uniforms(gl, prog);
      promote(gl, seed, key, patch, assembled, prog, uni);
    } catch (e) {
      console.error('[semantic-synth] shader compile failed:', e);
    }
    return;
  }

  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    if (prog) gl.deleteProgram(prog);
    console.error('[semantic-synth] failed to create shader/program objects');
    return;
  }

  gl.shaderSource(vs, FULLSCREEN_VERT);
  gl.compileShader(vs);
  gl.shaderSource(fs, assembled.fragSrc);
  gl.compileShader(fs);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);

  pending = { seed, key, patch, assembled, prog, vs, fs };
}

function pollPending(gl: WebGL2RenderingContext): void {
  if (!pending) return;
  const ext = getParallelCompileExt(gl);
  if (!ext) return;

  const done = gl.getProgramParameter(pending.prog, ext.COMPLETION_STATUS_KHR);
  if (!done) return;

  const { seed, key, patch, assembled, prog, vs, fs } = pending;
  pending = null;

  const vsOk = gl.getShaderParameter(vs, gl.COMPILE_STATUS);
  const fsOk = gl.getShaderParameter(fs, gl.COMPILE_STATUS);
  const linkOk = gl.getProgramParameter(prog, gl.LINK_STATUS);

  if (!vsOk || !fsOk || !linkOk) {
    const vsLog = gl.getShaderInfoLog(vs) ?? '';
    const fsLog = gl.getShaderInfoLog(fs) ?? '';
    const progLog = gl.getProgramInfoLog(prog) ?? '';
    console.error('[semantic-synth] async shader compile/link failed:\n', vsLog, fsLog, progLog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteProgram(prog);
    return;
  }

  gl.detachShader(prog, vs);
  gl.detachShader(prog, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  const uni = new Uniforms(gl, prog);
  promote(gl, seed, key, patch, assembled, prog, uni);
}

function ensurePatch(gl: WebGL2RenderingContext, seed: string): void {
  if (desiredSeed === seed) {
    // Still waiting on async compile for this seed, or already current.
    if (pending && pending.seed === seed) {
      pollPending(gl);
    }
    return;
  }

  desiredSeed = seed;
  abandonPending(gl);

  const patch = derivePatch(seed, { catalog: inlineCatalog });
  const assembled = assemblePatch(patch, inlineCatalog);
  const key = serializePatch(patch);

  const hit = cacheLookup(key);
  if (hit) {
    current = {
      seed,
      key,
      patch,
      assembled,
      prog: hit.prog,
      uni: hit.uni,
      modEngine: createModulationEngine(patch.routes),
    };
    return;
  }

  beginCompile(gl, seed, key, patch, assembled);
}

export const semanticSynthScene: GlScene = {
  kind: 'gl',
  id: 'semantic-synth',
  name: 'Semantic Synth',

  init(gl: WebGL2RenderingContext) {
    vao = createEmptyVao(gl);
    desiredSeed = null;
    current = null;
    pending = null;
    programCache.length = 0;
    parallelCompile = undefined;
    void gl;
  },

  draw(s: GlSceneContext) {
    const { gl, pxW, pxH, t, dt, audio, hue, va } = s;
    if (!vao) return;

    ensurePatch(gl, va.seed);
    pollPending(gl);

    if (!current) return;

    const { patch, assembled, prog, uni, modEngine } = current;
    const resolved = modEngine.update(audio, t, dt);
    const values = applyModulation(patch, inlineCatalog, resolved);

    gl.useProgram(prog);
    uni.f2('uRes', pxW, pxH);
    uni.f1('uTime', t);
    uni.f1('uBass', audio.bass);
    uni.f1('uMid', audio.mid);
    uni.f1('uTreble', audio.treble);
    uni.f1('uLevel', audio.level);
    uni.f1('uBeat', audio.tempoLocked ? audio.gridPulse : audio.beatIntensity);
    uni.f1('uFade', 1.0);

    const seedLoc = gl.getUniformLocation(prog, SEED_UNIFORM);
    if (seedLoc) {
      gl.uniform1ui(seedLoc, seedToU32(patch.seed) >>> 0);
    }

    for (const { opId, name } of assembled.nsUniforms) {
      const loc = gl.getUniformLocation(prog, name);
      if (loc) {
        gl.uniform1ui(loc, namespaceToU32(`op:${opId}`) >>> 0);
      }
    }

    for (const { opId, paramId, name } of assembled.uniforms) {
      const op = patch.operators.find((o) => o.id === opId);
      if (!op) continue;
      const gen = inlineCatalog.get(op.generatorId);
      if (!gen) continue;
      const paramDef = gen.def.parameters.find((p) => p.id === paramId);
      if (!paramDef) continue;
      const key = `${opId}.${paramId}`;
      const raw = values.get(key) ?? op.parameters[paramId] ?? paramDef.default;
      // Patch の hue を絶対値ではなくレンダラ hue からのオフセットとして扱う。
      // hue サイクルと固定 hue の UI をこのシーンでも効かせるため。
      const value = paramId === 'hue' && typeof raw === 'number' ? (raw + hue) % 360 : raw;
      setParamUniform(gl, uni, name, paramDef.kind, value, paramDef.options);
    }

    drawFullscreen(gl, vao);
  },

  dispose(gl: WebGL2RenderingContext) {
    abandonPending(gl);
    const deleted = new Set<WebGLProgram>();
    for (const entry of programCache) {
      if (!deleted.has(entry.prog)) {
        gl.deleteProgram(entry.prog);
        deleted.add(entry.prog);
      }
    }
    programCache.length = 0;
    if (current && !deleted.has(current.prog)) {
      gl.deleteProgram(current.prog);
    }
    current = null;
    desiredSeed = null;
    if (vao) gl.deleteVertexArray(vao);
    vao = null;
    parallelCompile = undefined;
  },
};
