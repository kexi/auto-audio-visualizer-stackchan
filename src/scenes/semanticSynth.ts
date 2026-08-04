import type { GlScene, GlSceneContext } from './types';
import {
  compileProgram,
  createEmptyVao,
  drawFullscreen,
  FULLSCREEN_VERT,
  Uniforms,
} from '../render/glutil';
import { assemblePatch, SEED_UNIFORM, type AssembledShader } from '../synth/gl/assemble';
import { inlineCatalog } from '../synth/generators';
import { namespaceToU32, seedToU32 } from '../synth/rng';
import type { VisualPatch } from '../synth/types';

/**
 * Semantic Synth — Phase 1 demo scene.
 * Builds a fixed grid→noise→mirror→neon Patch, assembles it to GLSL, and
 * recompiles when the variation seed changes.
 */

let prog: WebGLProgram | null = null;
let vao: WebGLVertexArrayObject | null = null;
let uni: Uniforms | null = null;
let lastSeed: string | null = null;
let lastFragSrc: string | null = null;
let assembled: AssembledShader | null = null;
let currentPatch: VisualPatch | null = null;

function buildDefaultPatch(seed: string, hue: number): VisualPatch {
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
        parameters: { hue, intensity: 1.2 },
      },
    ],
    routes: [],
    palette: {
      mode: 'mono',
      hueOffset: 0,
      saturation: 80,
      lightness: 55,
    },
    composition: {
      symmetry: 4,
      scale: 1,
      speed: 1,
    },
    qualityTier: 'medium',
  };
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
  // silence unused gl when Uniforms covers it
  void gl;
}

function rebuild(gl: WebGL2RenderingContext, seed: string, hue: number): void {
  const patch = buildDefaultPatch(seed, hue);
  const next = assemblePatch(patch, inlineCatalog);

  // Recompile only when fragment source actually changes (structure/params shape).
  if (next.fragSrc !== lastFragSrc || !prog) {
    if (prog) {
      gl.deleteProgram(prog);
      prog = null;
      uni = null;
    }
    prog = compileProgram(gl, FULLSCREEN_VERT, next.fragSrc);
    uni = new Uniforms(gl, prog);
    lastFragSrc = next.fragSrc;
  }

  assembled = next;
  currentPatch = patch;
  lastSeed = seed;
}

export const semanticSynthScene: GlScene = {
  kind: 'gl',
  id: 'semantic-synth',
  name: 'Semantic Synth',

  init(gl: WebGL2RenderingContext) {
    vao = createEmptyVao(gl);
    // Program is built on first draw (needs seed from variation context).
    prog = null;
    uni = null;
    lastSeed = null;
    lastFragSrc = null;
    assembled = null;
    currentPatch = null;
  },

  draw(s: GlSceneContext) {
    const { gl, pxW, pxH, t, audio, hue, va } = s;
    if (!vao) return;

    if (lastSeed !== va.seed || !prog || !uni || !assembled || !currentPatch) {
      rebuild(gl, va.seed, hue);
    }
    if (!prog || !uni || !assembled || !currentPatch) return;

    // Map scene hue into neon material each frame (shader structure unchanged).
    const matOp = currentPatch.operators.find((o) => o.id === 'mat0');
    if (matOp) {
      matOp.parameters.hue = hue;
    }

    gl.useProgram(prog);
    uni.f2('uRes', pxW, pxH);
    uni.f1('uTime', t);
    uni.f1('uBass', audio.bass);
    uni.f1('uMid', audio.mid);
    uni.f1('uTreble', audio.treble);
    uni.f1('uLevel', audio.level);
    uni.f1('uBeat', audio.tempoLocked ? audio.gridPulse : audio.beatIntensity);

    const seedLoc = gl.getUniformLocation(prog, SEED_UNIFORM);
    if (seedLoc) {
      gl.uniform1ui(seedLoc, seedToU32(currentPatch.seed) >>> 0);
    }

    for (const { opId, name } of assembled.nsUniforms) {
      const loc = gl.getUniformLocation(prog, name);
      if (loc) {
        gl.uniform1ui(loc, namespaceToU32(`op:${opId}`) >>> 0);
      }
    }

    for (const { opId, paramId, name } of assembled.uniforms) {
      const op = currentPatch.operators.find((o) => o.id === opId);
      if (!op) continue;
      const gen = inlineCatalog.get(op.generatorId);
      if (!gen) continue;
      const paramDef = gen.def.parameters.find((p) => p.id === paramId);
      if (!paramDef) continue;
      const raw = op.parameters[paramId] ?? paramDef.default;
      setParamUniform(gl, uni, name, paramDef.kind, raw, paramDef.options);
    }

    drawFullscreen(gl, vao);
  },

  dispose(gl: WebGL2RenderingContext) {
    if (prog) gl.deleteProgram(prog);
    if (vao) gl.deleteVertexArray(vao);
    prog = null;
    vao = null;
    uni = null;
    lastSeed = null;
    lastFragSrc = null;
    assembled = null;
    currentPatch = null;
  },
};
