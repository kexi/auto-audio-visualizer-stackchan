import type { GlScene, GlSceneContext } from './types';
import {
  compileProgram,
  createEmptyVao,
  createFbo,
  disposeFbo,
  drawFullscreen,
  type Fbo,
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
import { createQualityController, type QualityController } from '../synth/quality';
import { namespaceToU32, seedToU32 } from '../synth/rng';
import { serializePatch } from '../synth/schema';
import { createTransition, sameTopology, type Transition } from '../synth/transition';
import { DEFAULT_TRANSITION, type VisualPatch } from '../synth/types';

/**
 * Semantic Synth — the generative scene.
 *
 * Derives a Patch from the variation seed, assembles GLSL, modulates params
 * from audio, and caches compiled programs (LRU, async when available).
 *
 * Two mechanisms sit on top of that:
 * - A/B decks. A seed change that keeps the operator topology morphs in place
 *   on a single deck (same shader, interpolated uniforms). A topology change
 *   warms a second deck up and crossfades once its program has linked.
 * - Internal resolution scaling. Below 1.0 the decks render into an offscreen
 *   FBO that is blitted back up to the drawing buffer.
 */

const CACHE_LIMIT = 8;

/** Internal-resolution ladder, highest first. Mirrors the quality controller. */
const SCALE_STEPS = [1.0, 0.75, 0.5] as const;
/** Floor of the ladder — we never step below this on our own. */
const MIN_SCALE = 0.5;

/**
 * Upscale pass for the internal-resolution path. The offscreen colour is
 * already premultiplied, so it is passed straight through and composited by the
 * renderer's ONE / ONE_MINUS_SRC_ALPHA blend.
 */
const BLIT_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
void main() {
  fragColor = texture(uSrc, vUv);
}`;

type CacheEntry = {
  key: string;
  prog: WebGLProgram;
  uni: Uniforms;
};

/**
 * One playable patch: its program plus the CPU-side state that has to survive
 * across frames (modulation smoothing, an in-place parameter morph).
 */
type SynthDeck = {
  seed: string;
  /** The patch this deck settles on. */
  patch: VisualPatch;
  /** What is actually rendered this frame (interpolated while morphing). */
  live: VisualPatch;
  /** Same-topology parameter morph running on this deck, if any. */
  morph: Transition | null;
  assembled: AssembledShader;
  prog: WebGLProgram;
  uni: Uniforms;
  modEngine: ModulationEngine;
};

/** A patch whose program is being resolved (cache hit or compile). */
type Loading = {
  seed: string;
  key: string;
  patch: VisualPatch;
  assembled: AssembledShader;
};

/** GL objects of an in-flight async compile. Always paired with {@link loading}. */
type PendingCompile = {
  prog: WebGLProgram;
  vs: WebGLShader;
  fs: WebGLShader;
};

/** A linked program plus its uniform-location cache. */
type Compiled = {
  prog: WebGLProgram;
  uni: Uniforms;
};

/**
 * Deck state machine.
 * - idle:   one deck on screen (possibly morphing in place)
 * - warmup: a topology change is being compiled; only the old deck draws
 * - fading: both decks draw, crossfaded by the transition
 */
type DeckPhase = 'idle' | 'warmup' | 'fading';

let vao: WebGLVertexArrayObject | null = null;
/** The seed the state machine is converging to — not necessarily on screen yet. */
let targetSeed: string | null = null;
let phase: DeckPhase = 'idle';
/** Deck A: what the audience sees. */
let front: SynthDeck | null = null;
/** Deck B: only present while crossfading. */
let incoming: SynthDeck | null = null;
/** The crossfade between the two decks; set only while phase === 'fading'. */
let deckFade: Transition | null = null;
let loading: Loading | null = null;
let pending: PendingCompile | null = null;
/** LRU: oldest at index 0, newest at end. */
const programCache: CacheEntry[] = [];
let parallelCompile: { COMPLETION_STATUS_KHR: number } | null | undefined;

// ---- internal resolution ----
let quality: QualityController | null = null;
let scaleTarget: Fbo | null = null;
let blit: Compiled | null = null;

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

/** True while a live deck still needs this program — eviction must skip it. */
function progInUse(prog: WebGLProgram): boolean {
  return front?.prog === prog || incoming?.prog === prog;
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
    if (old.prog !== entry.prog && !progInUse(old.prog)) {
      gl.deleteProgram(old.prog);
    }
  }
  programCache.push(entry);
  while (programCache.length > CACHE_LIMIT) {
    let victimIdx = -1;
    for (let i = 0; i < programCache.length; i++) {
      if (!progInUse(programCache[i]!.prog)) {
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

/** Drop a warmup whose target is no longer wanted. */
function cancelLoad(gl: WebGL2RenderingContext): void {
  abandonPending(gl);
  loading = null;
}

/**
 * Start compiling `assembled`. Returns the finished program when the driver has
 * no async-compile extension (compilation is synchronous there); otherwise the
 * link is polled by {@link advanceLoad}.
 */
function beginCompile(gl: WebGL2RenderingContext, assembled: AssembledShader): Compiled | null {
  const ext = getParallelCompileExt(gl);
  if (!ext) {
    try {
      const prog = compileProgram(gl, FULLSCREEN_VERT, assembled.fragSrc);
      return { prog, uni: new Uniforms(gl, prog) };
    } catch (e) {
      console.error('[semantic-synth] shader compile failed:', e);
      return null;
    }
  }

  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    if (prog) gl.deleteProgram(prog);
    console.error('[semantic-synth] failed to create shader/program objects');
    return null;
  }

  gl.shaderSource(vs, FULLSCREEN_VERT);
  gl.compileShader(vs);
  gl.shaderSource(fs, assembled.fragSrc);
  gl.compileShader(fs);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);

  pending = { prog, vs, fs };
  return null;
}

function makeDeck(l: Loading, compiled: Compiled): SynthDeck {
  return {
    seed: l.seed,
    patch: l.patch,
    live: l.patch,
    morph: null,
    assembled: l.assembled,
    prog: compiled.prog,
    uni: compiled.uni,
    modEngine: createModulationEngine(l.patch.routes),
  };
}

/**
 * Hand the freshly resolved program to a deck. With no deck on screen it takes
 * over directly (cold start); otherwise it becomes deck B and the crossfade
 * starts here — never earlier, so the fade can't stall on a pending link.
 */
function installLoaded(gl: WebGL2RenderingContext, compiled: Compiled, nowMs: number): void {
  const l = loading;
  if (!l) return;
  loading = null;

  const deck = makeDeck(l, compiled);
  if (!front) {
    // Cold start: nothing to fade from.
    front = deck;
    phase = 'idle';
  } else {
    // warmup → fading. startMs is *now*, so the fade covers its full duration
    // regardless of how long the compile took.
    incoming = deck;
    deckFade = createTransition(front.live, deck.patch, DEFAULT_TRANSITION, nowMs);
    phase = 'fading';
  }
  // Insert after the deck exists so eviction can see the program is in use.
  cacheInsert(gl, { key: l.key, prog: compiled.prog, uni: compiled.uni });
}

/**
 * Begin warming a new topology up. Replaces whatever warmup was in flight —
 * seed changes never queue, only the newest one matters.
 */
function startLoad(
  gl: WebGL2RenderingContext,
  seed: string,
  patch: VisualPatch,
  nowMs: number,
): void {
  const key = serializePatch(patch);
  const assembled = assemblePatch(patch, inlineCatalog);

  // Same topology as the warmup already linking → identical shader source, so
  // keep that link running and just retarget its parameters.
  if (loading && pending && sameTopology(loading.patch, patch)) {
    loading = { seed, key, patch, assembled };
    return;
  }

  cancelLoad(gl);
  loading = { seed, key, patch, assembled };
  // idle → warmup. The old deck keeps drawing alone until the program links.
  phase = 'warmup';

  const hit = cacheLookup(key);
  if (hit) {
    installLoaded(gl, { prog: hit.prog, uni: hit.uni }, nowMs);
    return;
  }
  const compiled = beginCompile(gl, assembled);
  if (compiled) installLoaded(gl, compiled, nowMs);
}

/** Drive an in-flight compile: install it once linked, drop it if it failed. */
function advanceLoad(gl: WebGL2RenderingContext, nowMs: number): void {
  if (!loading || !pending) return;
  const ext = getParallelCompileExt(gl);
  if (!ext) return;

  const done = gl.getProgramParameter(pending.prog, ext.COMPLETION_STATUS_KHR);
  if (!done) return;

  const { prog, vs, fs } = pending;
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
    // warmup → idle. Give up on this patch; the old deck keeps playing.
    loading = null;
    phase = 'idle';
    return;
  }

  gl.detachShader(prog, vs);
  gl.detachShader(prog, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  installLoaded(gl, { prog, uni: new Uniforms(gl, prog) }, nowMs);
}

/** React to a seed change. The topology decides which kind of transition runs. */
function syncSeed(gl: WebGL2RenderingContext, seed: string, nowMs: number): void {
  if (seed === targetSeed) return;
  // A crossfade owns both decks, so a new seed can't be started here. targetSeed
  // is left stale on purpose: the comparison above re-fires once we reach idle.
  if (phase === 'fading') return;

  targetSeed = seed;
  const patch = derivePatch(seed, { catalog: inlineCatalog });

  if (front && sameTopology(front.live, patch)) {
    // Same operator graph → same shader. Morph in place on the single deck; the
    // warmup (if any) targeted a topology nobody wants any more.
    cancelLoad(gl);
    phase = 'idle';
    front.morph = createTransition(front.live, patch, DEFAULT_TRANSITION, nowMs);
    front.patch = patch;
    return;
  }

  // Different graph → a second deck has to be compiled before anything fades.
  startLoad(gl, seed, patch, nowMs);
}

/** Advance a deck's in-place morph and refresh what it renders this frame. */
function updateDeck(deck: SynthDeck, nowMs: number): void {
  const morph = deck.morph;
  if (!morph) return;

  const sample = morph.sample(nowMs);
  deck.live = sample.patch;
  if (sample.done) {
    deck.live = deck.patch;
    deck.morph = null;
    // Swap the modulation engine only once the routes have settled: rebuilding
    // it per frame would reset the exponential smoothing state every frame.
    deck.modEngine = createModulationEngine(deck.patch.routes);
  }
}

/** Advance the crossfade and return each deck's uFade for this frame. */
function advanceFade(nowMs: number): { fadeA: number; fadeB: number } {
  if (phase !== 'fading' || !deckFade || !incoming) return { fadeA: 1, fadeB: 0 };

  const sample = deckFade.sample(nowMs);
  if (sample.done) {
    // fading → idle. The old deck is released: its modulation engine goes with
    // it, its program stays in the LRU cache (and becomes evictable again).
    front = incoming;
    incoming = null;
    deckFade = null;
    phase = 'idle';
    targetSeed = front.seed;
    return { fadeA: 1, fadeB: 0 };
  }
  return { fadeA: sample.fadeA, fadeB: sample.fadeB };
}

/** Draw one deck at the given fade level into whatever target is bound. */
function drawDeck(
  s: GlSceneContext,
  deck: SynthDeck,
  fade: number,
  renderW: number,
  renderH: number,
): void {
  const { gl, t, dt, audio, hue } = s;
  const { assembled, prog, uni, modEngine } = deck;
  const patch = deck.live;

  const resolved = modEngine.update(audio, t, dt);
  const values = applyModulation(patch, inlineCatalog, resolved);

  gl.useProgram(prog);
  // uRes is the size of the *render target*, so the internal-resolution path
  // keeps the aspect correct (fwidth-based AA follows the target on its own).
  uni.f2('uRes', renderW, renderH);
  uni.f1('uTime', t);
  uni.f1('uBass', audio.bass);
  uni.f1('uMid', audio.mid);
  uni.f1('uTreble', audio.treble);
  uni.f1('uLevel', audio.level);
  uni.f1('uBeat', audio.tempoLocked ? audio.gridPulse : audio.beatIntensity);
  uni.f1('uFade', fade);

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

  if (vao) drawFullscreen(gl, vao);
}

/** The next lower rung of {@link SCALE_STEPS}, never raising the resolution. */
function stepDownScale(scale: number): number {
  for (const step of SCALE_STEPS) {
    if (step < scale - 1e-6) return step;
  }
  // Already at (or below) the floor — hold there rather than dropping further.
  return Math.min(scale, MIN_SCALE);
}

/** Offscreen target for the internal-resolution path, sized to pxW/pxH * scale. */
function ensureScaleTarget(
  gl: WebGL2RenderingContext,
  pxW: number,
  pxH: number,
  scale: number,
): Fbo | null {
  const w = Math.max(1, Math.round(pxW * scale));
  const h = Math.max(1, Math.round(pxH * scale));
  if (scaleTarget && scaleTarget.w === w && scaleTarget.h === h) return scaleTarget;

  if (scaleTarget) {
    disposeFbo(gl, scaleTarget);
    scaleTarget = null;
  }
  try {
    // RGBA8: the decks output premultiplied 8-bit colour, same as the canvas.
    scaleTarget = createFbo(gl, w, h);
  } catch (e) {
    console.error('[semantic-synth] offscreen target failed; drawing at full res:', e);
    scaleTarget = null;
  }
  return scaleTarget;
}

/** Upscale the offscreen colour onto the drawing buffer. */
function blitToScreen(gl: WebGL2RenderingContext, src: Fbo, pxW: number, pxH: number): void {
  if (!blit || !vao) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, pxW, pxH);
  gl.useProgram(blit.prog);
  // createFbo already set LINEAR / CLAMP_TO_EDGE on the texture, which is
  // exactly what the upscale wants; only the unit binding is ours to make.
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src.tex);
  blit.uni.i1('uSrc', 0);
  drawFullscreen(gl, vao);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

export const semanticSynthScene: GlScene = {
  kind: 'gl',
  id: 'semantic-synth',
  name: 'Semantic Synth',

  init(gl: WebGL2RenderingContext) {
    // Called on first activation and after a context loss: every GL object from
    // a previous context is already gone, so drop the references and rebuild.
    vao = createEmptyVao(gl);
    targetSeed = null;
    phase = 'idle';
    front = null;
    incoming = null;
    deckFade = null;
    loading = null;
    pending = null;
    programCache.length = 0;
    parallelCompile = undefined;
    scaleTarget = null;
    quality = createQualityController();

    try {
      const prog = compileProgram(gl, FULLSCREEN_VERT, BLIT_FRAG);
      blit = { prog, uni: new Uniforms(gl, prog) };
    } catch (e) {
      console.error('[semantic-synth] blit program failed; internal scaling disabled:', e);
      blit = null;
    }
  },

  draw(s: GlSceneContext) {
    const { gl, pxW, pxH, t, dt, va } = s;
    if (!vao) return;

    // Scene time drives every transition — never wall-clock, so the scene stays
    // reproducible under a stubbed clock.
    const nowMs = t * 1000;

    syncSeed(gl, va.seed, nowMs);
    advanceLoad(gl, nowMs);

    if (front) updateDeck(front, nowMs);
    if (incoming) updateDeck(incoming, nowMs);
    const { fadeA, fadeB } = advanceFade(nowMs);

    // Keep the controller fed even on frames that draw nothing.
    let scale = quality ? quality.update(dt * 1000, nowMs) : 1;
    if (phase === 'fading') {
      // Both decks run their full-screen shader this frame, so fill rate roughly
      // doubles. Drop one rung below whatever the controller asked for — cheap
      // insurance against a stutter landing right on the transition.
      scale = stepDownScale(scale);
    }

    if (!front) return;

    // scale === 1 stays on the direct path: no FBO, no blit, zero overhead when
    // nothing is struggling.
    const target = scale < 1 && blit ? ensureScaleTarget(gl, pxW, pxH, scale) : null;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
      // Transparent clear, same premultiplied contract as the renderer's.
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    const renderW = target ? target.w : pxW;
    const renderH = target ? target.h : pxH;

    // Old deck first, new deck over it — premultiplied blend does the rest.
    drawDeck(s, front, fadeA, renderW, renderH);
    if (phase === 'fading' && incoming) {
      drawDeck(s, incoming, fadeB, renderW, renderH);
    }

    if (target) blitToScreen(gl, target, pxW, pxH);
  },

  resize(gl: WebGL2RenderingContext) {
    // The offscreen target is sized from the drawing buffer; drop it and let the
    // next frame rebuild it at the new size.
    if (scaleTarget) {
      disposeFbo(gl, scaleTarget);
      scaleTarget = null;
    }
  },

  dispose(gl: WebGL2RenderingContext) {
    abandonPending(gl);
    loading = null;
    const deleted = new Set<WebGLProgram>();
    for (const entry of programCache) {
      if (!deleted.has(entry.prog)) {
        gl.deleteProgram(entry.prog);
        deleted.add(entry.prog);
      }
    }
    programCache.length = 0;
    for (const deck of [front, incoming]) {
      if (deck && !deleted.has(deck.prog)) {
        gl.deleteProgram(deck.prog);
        deleted.add(deck.prog);
      }
    }
    front = null;
    incoming = null;
    deckFade = null;
    phase = 'idle';
    targetSeed = null;
    if (scaleTarget) {
      disposeFbo(gl, scaleTarget);
      scaleTarget = null;
    }
    if (blit) {
      gl.deleteProgram(blit.prog);
      blit = null;
    }
    quality = null;
    if (vao) gl.deleteVertexArray(vao);
    vao = null;
    parallelCompile = undefined;
  },
};
