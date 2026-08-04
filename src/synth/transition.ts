import type {
  CompositionSpec,
  ModulationRoute,
  PaletteSpec,
  TransitionEasing,
  TransitionSpec,
  VisualOperator,
  VisualPatch,
} from './types';

export function sameTopology(a: VisualPatch, b: VisualPatch): boolean {
  if (a.operators.length !== b.operators.length) return false;
  for (let i = 0; i < a.operators.length; i++) {
    const ao = a.operators[i]!;
    const bo = b.operators[i]!;
    if (
      ao.id !== bo.id ||
      ao.generatorId !== bo.generatorId ||
      ao.generatorVersion !== bo.generatorVersion
    ) {
      return false;
    }
  }
  return true;
}

export interface TransitionSample {
  patch: VisualPatch;
  fadeA: number;
  fadeB: number;
  needsDecks: boolean;
  done: boolean;
}

export interface Transition {
  readonly from: VisualPatch;
  readonly to: VisualPatch;
  readonly needsDecks: boolean;
  sample(nowMs: number): TransitionSample;
}

function clamp01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}

function applyEasing(t: number, easing: TransitionEasing): number {
  const c = clamp01(t);
  if (easing === 'linear') return c;
  // smoothstep: 3t² - 2t³
  return c * c * (3 - 2 * c);
}

/** Progress in [0,1] after easing. Pure — uses only nowMs/startMs/ms. */
function progress(nowMs: number, startMs: number, ms: number, easing: TransitionEasing): number {
  if (ms <= 0) return applyEasing(1, easing);
  return applyEasing((nowMs - startMs) / ms, easing);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpHue(a: number, b: number, t: number): number {
  let d = ((b - a + 540) % 360) - 180;
  return (((a + d * t) % 360) + 360) % 360;
}

type ParamValue = number | string | boolean;

function lerpParam(
  from: ParamValue | undefined,
  to: ParamValue | undefined,
  t: number,
): ParamValue {
  if (from === undefined && to === undefined) return 0;
  if (from === undefined) return to as ParamValue;
  if (to === undefined) return from;

  if (typeof from === 'boolean' || typeof to === 'boolean') {
    return t < 0.5 ? from : to;
  }
  if (typeof from === 'string' || typeof to === 'string') {
    return t < 0.5 ? from : to;
  }
  // both numbers
  if (Number.isInteger(from) && Number.isInteger(to)) {
    return Math.round(lerp(from, to, t));
  }
  return lerp(from, to, t);
}

function routeKey(r: ModulationRoute): string {
  return r.source + '\0' + r.target;
}

function lerpPalette(from: PaletteSpec, to: PaletteSpec, t: number): PaletteSpec {
  return {
    mode: t < 0.5 ? from.mode : to.mode,
    hueOffset: lerpHue(from.hueOffset, to.hueOffset, t),
    saturation: lerp(from.saturation, to.saturation, t),
    lightness: lerp(from.lightness, to.lightness, t),
  };
}

function lerpComposition(from: CompositionSpec, to: CompositionSpec, t: number): CompositionSpec {
  return {
    symmetry: lerpParam(from.symmetry, to.symmetry, t) as number,
    scale: lerp(from.scale, to.scale, t),
    speed: lerp(from.speed, to.speed, t),
  };
}

function lerpOperators(from: VisualOperator[], to: VisualOperator[], t: number): VisualOperator[] {
  return from.map((fo, i) => {
    const toOp = to[i]!;
    const keys = new Set([...Object.keys(fo.parameters), ...Object.keys(toOp.parameters)]);
    const parameters: Record<string, ParamValue> = {};
    for (const k of keys) {
      parameters[k] = lerpParam(fo.parameters[k], toOp.parameters[k], t);
    }
    return {
      id: fo.id,
      generatorId: fo.generatorId,
      generatorVersion: fo.generatorVersion,
      parameters,
    };
  });
}

function lerpRoutes(
  from: ModulationRoute[],
  to: ModulationRoute[],
  t: number,
  done: boolean,
): ModulationRoute[] {
  const fromMap = new Map<string, ModulationRoute>();
  for (const r of from) fromMap.set(routeKey(r), r);
  const toMap = new Map<string, ModulationRoute>();
  for (const r of to) toMap.set(routeKey(r), r);

  const keys = new Set([...fromMap.keys(), ...toMap.keys()]);
  const out: ModulationRoute[] = [];

  for (const key of keys) {
    const fr = fromMap.get(key);
    const tr = toMap.get(key);

    if (fr && tr) {
      out.push({
        source: tr.source,
        target: tr.target,
        amount: lerp(fr.amount, tr.amount, t),
        polarity: t < 0.5 ? fr.polarity : tr.polarity,
        smoothing: t < 0.5 ? fr.smoothing : tr.smoothing,
      });
    } else if (tr && !fr) {
      // fade in: 0 → to.amount
      out.push({
        source: tr.source,
        target: tr.target,
        amount: lerp(0, tr.amount, t),
        polarity: tr.polarity,
        smoothing: tr.smoothing,
      });
    } else if (fr && !tr) {
      // fade out: from.amount → 0; drop when done
      if (done) continue;
      out.push({
        source: fr.source,
        target: fr.target,
        amount: lerp(fr.amount, 0, t),
        polarity: fr.polarity,
        smoothing: fr.smoothing,
      });
    }
  }

  return out;
}

function sampleSameTopology(
  from: VisualPatch,
  to: VisualPatch,
  spec: TransitionSpec,
  startMs: number,
  nowMs: number,
): TransitionSample {
  const paletteT = progress(nowMs, startMs, spec.paletteMs, spec.easing);
  const paramT = progress(nowMs, startMs, spec.parameterMs, spec.easing);
  const modT = progress(nowMs, startMs, spec.modulationMs, spec.easing);

  const maxMs = Math.max(spec.paletteMs, spec.parameterMs, spec.modulationMs);
  const done = maxMs <= 0 || nowMs - startMs >= maxMs;

  const patch: VisualPatch = {
    schemaVersion: to.schemaVersion,
    seed: to.seed,
    qualityTier: to.qualityTier,
    operators: lerpOperators(from.operators, to.operators, paramT),
    palette: lerpPalette(from.palette, to.palette, paletteT),
    composition: lerpComposition(from.composition, to.composition, paramT),
    routes: lerpRoutes(from.routes, to.routes, modT, done),
  };

  return {
    patch,
    fadeA: 1,
    fadeB: 0,
    needsDecks: false,
    done,
  };
}

function sampleDeckTopology(
  to: VisualPatch,
  spec: TransitionSpec,
  startMs: number,
  nowMs: number,
): TransitionSample {
  const t = progress(nowMs, startMs, spec.topologyMs, spec.easing);
  const done = spec.topologyMs <= 0 || nowMs - startMs >= spec.topologyMs;

  return {
    patch: to,
    fadeA: 1 - t,
    fadeB: t,
    needsDecks: true,
    done,
  };
}

export function createTransition(
  from: VisualPatch,
  to: VisualPatch,
  spec: TransitionSpec,
  startMs: number,
): Transition {
  const needsDecks = !sameTopology(from, to);

  return {
    from,
    to,
    needsDecks,
    sample(nowMs: number): TransitionSample {
      if (needsDecks) {
        return sampleDeckTopology(to, spec, startMs, nowMs);
      }
      return sampleSameTopology(from, to, spec, startMs, nowMs);
    },
  };
}
