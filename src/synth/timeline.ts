import type { AudioFrame } from '../audio/types';
import type { TransitionSpec, VisualPatch } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TimeAnchor =
  | { kind: 'seconds'; atSec: number }
  | { kind: 'bar'; bar: number }
  | { kind: 'external'; id: string };

export type DurationSpec =
  | { kind: 'seconds'; sec: number }
  | { kind: 'bars'; bars: number }
  | { kind: 'untilNext' };

export interface SemanticIntent {
  label?: string;
  seed?: string;
  patch?: VisualPatch;
}

export interface VisualEvent {
  id: string;
  start: TimeAnchor;
  duration: DurationSpec;
  intent: SemanticIntent;
  transition: TransitionSpec;
  /** 0..1 */
  confidence: number;
  locked: boolean;
}

export interface PerformanceTimeline {
  lockedUntilSec: number;
  events: VisualEvent[];
}

export type TimelineOp =
  | { op: 'add'; event: VisualEvent }
  | { op: 'replace'; id: string; event: VisualEvent }
  | { op: 'remove'; id: string }
  | { op: 'setIntent'; id: string; intent: SemanticIntent }
  | { op: 'setTransition'; id: string; transition: TransitionSpec }
  | { op: 'shift'; id: string; anchor: TimeAnchor }
  | { op: 'setLockedUntil'; sec: number };

export interface OpResult {
  ok: boolean;
  /** ok=false → original unchanged (same reference) */
  timeline: PerformanceTimeline;
  issue?: string;
}

export interface TimeContext {
  nowSec: number;
  barCount: number;
  /** 0..1 */
  barPhase: number;
  /** 0 → bar anchors unresolvable */
  bpm: number;
  tempoLocked: boolean;
}

export interface SchedulerState {
  /** array for JSON-serializability */
  firedIds: string[];
}

export interface DueEvent {
  event: VisualEvent;
  firedAtSec: number;
}

// ---------------------------------------------------------------------------
// Cloning
// ---------------------------------------------------------------------------

function cloneIntent(intent: SemanticIntent): SemanticIntent {
  const out: SemanticIntent = {};
  if (intent.label !== undefined) out.label = intent.label;
  if (intent.seed !== undefined) out.seed = intent.seed;
  if (intent.patch !== undefined) {
    out.patch = structuredClone(intent.patch);
  }
  return out;
}

function cloneAnchor(anchor: TimeAnchor): TimeAnchor {
  switch (anchor.kind) {
    case 'seconds':
      return { kind: 'seconds', atSec: anchor.atSec };
    case 'bar':
      return { kind: 'bar', bar: anchor.bar };
    case 'external':
      return { kind: 'external', id: anchor.id };
  }
}

function cloneDuration(duration: DurationSpec): DurationSpec {
  switch (duration.kind) {
    case 'seconds':
      return { kind: 'seconds', sec: duration.sec };
    case 'bars':
      return { kind: 'bars', bars: duration.bars };
    case 'untilNext':
      return { kind: 'untilNext' };
  }
}

function cloneTransition(t: TransitionSpec): TransitionSpec {
  return {
    paletteMs: t.paletteMs,
    parameterMs: t.parameterMs,
    modulationMs: t.modulationMs,
    topologyMs: t.topologyMs,
    easing: t.easing,
  };
}

function cloneEvent(event: VisualEvent): VisualEvent {
  return {
    id: event.id,
    start: cloneAnchor(event.start),
    duration: cloneDuration(event.duration),
    intent: cloneIntent(event.intent),
    transition: cloneTransition(event.transition),
    confidence: event.confidence,
    locked: event.locked,
  };
}

function cloneTimeline(tl: PerformanceTimeline): PerformanceTimeline {
  return {
    lockedUntilSec: tl.lockedUntilSec,
    events: tl.events.map(cloneEvent),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function validateAnchor(anchor: TimeAnchor): string | null {
  if (!anchor || typeof anchor !== 'object') return 'invalid anchor';
  switch (anchor.kind) {
    case 'seconds':
      if (!isFiniteNumber(anchor.atSec)) return 'anchor.atSec must be finite';
      return null;
    case 'bar':
      if (!isFiniteNumber(anchor.bar)) return 'anchor.bar must be finite';
      return null;
    case 'external':
      if (typeof anchor.id !== 'string' || anchor.id.length === 0) {
        return 'anchor.id must be a non-empty string';
      }
      return null;
    default:
      return 'unknown anchor kind';
  }
}

function validateDuration(duration: DurationSpec): string | null {
  if (!duration || typeof duration !== 'object') return 'invalid duration';
  switch (duration.kind) {
    case 'seconds':
      if (!isFiniteNumber(duration.sec)) return 'duration.sec must be finite';
      return null;
    case 'bars':
      if (!isFiniteNumber(duration.bars)) return 'duration.bars must be finite';
      return null;
    case 'untilNext':
      return null;
    default:
      return 'unknown duration kind';
  }
}

function validateTransition(t: TransitionSpec): string | null {
  if (!t || typeof t !== 'object') return 'invalid transition';
  if (!isFiniteNumber(t.paletteMs)) return 'transition.paletteMs must be finite';
  if (!isFiniteNumber(t.parameterMs)) return 'transition.parameterMs must be finite';
  if (!isFiniteNumber(t.modulationMs)) return 'transition.modulationMs must be finite';
  if (!isFiniteNumber(t.topologyMs)) return 'transition.topologyMs must be finite';
  if (t.easing !== 'linear' && t.easing !== 'easeInOut') {
    return 'transition.easing must be linear or easeInOut';
  }
  return null;
}

function validateIntent(intent: SemanticIntent): string | null {
  if (!intent || typeof intent !== 'object') return 'invalid intent';
  if (intent.label !== undefined && typeof intent.label !== 'string') {
    return 'intent.label must be a string';
  }
  if (intent.seed !== undefined && typeof intent.seed !== 'string') {
    return 'intent.seed must be a string';
  }
  // patch shape is trusted when present (full validation is for recordings)
  return null;
}

function validateEvent(event: VisualEvent): string | null {
  if (!event || typeof event !== 'object') return 'invalid event';
  if (typeof event.id !== 'string' || event.id.length === 0) {
    return 'event.id must be a non-empty string';
  }
  const a = validateAnchor(event.start);
  if (a) return a;
  const d = validateDuration(event.duration);
  if (d) return d;
  const i = validateIntent(event.intent);
  if (i) return i;
  const t = validateTransition(event.transition);
  if (t) return t;
  if (!isFiniteNumber(event.confidence) || event.confidence < 0 || event.confidence > 1) {
    return 'event.confidence must be a finite number in 0..1';
  }
  if (typeof event.locked !== 'boolean') return 'event.locked must be a boolean';
  return null;
}

// ---------------------------------------------------------------------------
// Protection
// ---------------------------------------------------------------------------

function findEventIndex(tl: PerformanceTimeline, id: string): number {
  return tl.events.findIndex((e) => e.id === id);
}

/**
 * Reject modify ops when the target event is locked or its fire time is
 * strictly before lockedUntilSec (when resolvable).
 */
function protectionIssue(
  event: VisualEvent,
  tl: PerformanceTimeline,
  ctx: TimeContext,
): string | null {
  if (event.locked) return `event "${event.id}" is locked`;
  const resolved = resolveAnchorSec(event.start, ctx);
  if (resolved !== null && resolved < tl.lockedUntilSec) {
    return `event "${event.id}" fires at ${resolved}s which is before lockedUntilSec ${tl.lockedUntilSec}`;
  }
  return null;
}

function fail(tl: PerformanceTimeline, issue: string): OpResult {
  return { ok: false, timeline: tl, issue };
}

function ok(tl: PerformanceTimeline): OpResult {
  return { ok: true, timeline: tl };
}

// ---------------------------------------------------------------------------
// applyOp
// ---------------------------------------------------------------------------

export function applyOp(tl: PerformanceTimeline, op: TimelineOp, ctx: TimeContext): OpResult {
  switch (op.op) {
    case 'add': {
      const issue = validateEvent(op.event);
      if (issue) return fail(tl, issue);
      if (tl.events.some((e) => e.id === op.event.id)) {
        return fail(tl, `duplicate event id "${op.event.id}"`);
      }
      const next = cloneTimeline(tl);
      next.events.push(cloneEvent(op.event));
      return ok(next);
    }

    case 'replace': {
      if (typeof op.id !== 'string' || op.id.length === 0) {
        return fail(tl, 'replace id must be a non-empty string');
      }
      const idx = findEventIndex(tl, op.id);
      if (idx < 0) return fail(tl, `unknown event id "${op.id}"`);
      const existing = tl.events[idx]!;
      const prot = protectionIssue(existing, tl, ctx);
      if (prot) return fail(tl, prot);
      if (op.event.id !== op.id) {
        return fail(tl, `replace event.id "${op.event.id}" must equal target id "${op.id}"`);
      }
      const issue = validateEvent(op.event);
      if (issue) return fail(tl, issue);
      const next = cloneTimeline(tl);
      next.events[idx] = cloneEvent(op.event);
      return ok(next);
    }

    case 'remove': {
      if (typeof op.id !== 'string' || op.id.length === 0) {
        return fail(tl, 'remove id must be a non-empty string');
      }
      const idx = findEventIndex(tl, op.id);
      if (idx < 0) return fail(tl, `unknown event id "${op.id}"`);
      const existing = tl.events[idx]!;
      const prot = protectionIssue(existing, tl, ctx);
      if (prot) return fail(tl, prot);
      const next = cloneTimeline(tl);
      next.events.splice(idx, 1);
      return ok(next);
    }

    case 'setIntent': {
      if (typeof op.id !== 'string' || op.id.length === 0) {
        return fail(tl, 'setIntent id must be a non-empty string');
      }
      const idx = findEventIndex(tl, op.id);
      if (idx < 0) return fail(tl, `unknown event id "${op.id}"`);
      const existing = tl.events[idx]!;
      const prot = protectionIssue(existing, tl, ctx);
      if (prot) return fail(tl, prot);
      const issue = validateIntent(op.intent);
      if (issue) return fail(tl, issue);
      const next = cloneTimeline(tl);
      next.events[idx] = {
        ...next.events[idx]!,
        intent: cloneIntent(op.intent),
      };
      return ok(next);
    }

    case 'setTransition': {
      if (typeof op.id !== 'string' || op.id.length === 0) {
        return fail(tl, 'setTransition id must be a non-empty string');
      }
      const idx = findEventIndex(tl, op.id);
      if (idx < 0) return fail(tl, `unknown event id "${op.id}"`);
      const existing = tl.events[idx]!;
      const prot = protectionIssue(existing, tl, ctx);
      if (prot) return fail(tl, prot);
      const issue = validateTransition(op.transition);
      if (issue) return fail(tl, issue);
      const next = cloneTimeline(tl);
      next.events[idx] = {
        ...next.events[idx]!,
        transition: cloneTransition(op.transition),
      };
      return ok(next);
    }

    case 'shift': {
      if (typeof op.id !== 'string' || op.id.length === 0) {
        return fail(tl, 'shift id must be a non-empty string');
      }
      const idx = findEventIndex(tl, op.id);
      if (idx < 0) return fail(tl, `unknown event id "${op.id}"`);
      const existing = tl.events[idx]!;
      const prot = protectionIssue(existing, tl, ctx);
      if (prot) return fail(tl, prot);
      const anchorIssue = validateAnchor(op.anchor);
      if (anchorIssue) return fail(tl, anchorIssue);
      const newResolved = resolveAnchorSec(op.anchor, ctx);
      if (newResolved !== null && newResolved < tl.lockedUntilSec) {
        return fail(
          tl,
          `new anchor resolves to ${newResolved}s which is before lockedUntilSec ${tl.lockedUntilSec}`,
        );
      }
      const next = cloneTimeline(tl);
      next.events[idx] = {
        ...next.events[idx]!,
        start: cloneAnchor(op.anchor),
      };
      return ok(next);
    }

    case 'setLockedUntil': {
      if (!isFiniteNumber(op.sec)) {
        return fail(tl, 'setLockedUntil sec must be finite');
      }
      const next = cloneTimeline(tl);
      next.lockedUntilSec = op.sec;
      return ok(next);
    }

    default: {
      const _exhaustive: never = op;
      return fail(tl, `unknown op: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// TimeContext & anchor resolution
// ---------------------------------------------------------------------------

export function timeContextFrom(audio: AudioFrame, tSec: number): TimeContext {
  return {
    nowSec: tSec,
    barCount: audio.barCount,
    barPhase: audio.barPhase,
    bpm: audio.bpm,
    tempoLocked: audio.tempoLocked,
  };
}

/**
 * Resolve a TimeAnchor to absolute seconds, or null if unresolvable.
 * - seconds → atSec
 * - bar → if bpm <= 0 OR !tempoLocked → null;
 *   else 4 beats/bar, secPerBar = 240/bpm,
 *   nowSec + (bar - barCount - barPhase) * secPerBar
 * - external → null
 */
export function resolveAnchorSec(anchor: TimeAnchor, ctx: TimeContext): number | null {
  switch (anchor.kind) {
    case 'seconds':
      return anchor.atSec;
    case 'bar': {
      if (ctx.bpm <= 0 || !ctx.tempoLocked) return null;
      const secPerBar = 240 / ctx.bpm;
      return ctx.nowSec + (anchor.bar - ctx.barCount - ctx.barPhase) * secPerBar;
    }
    case 'external':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export function createSchedulerState(): SchedulerState {
  return { firedIds: [] };
}

function isDue(event: VisualEvent, ctx: TimeContext): boolean {
  switch (event.start.kind) {
    case 'seconds':
      return ctx.nowSec >= event.start.atSec;
    case 'bar':
      return event.start.bar <= ctx.barCount && ctx.bpm > 0 && ctx.tempoLocked;
    case 'external':
      return false;
  }
}

function firedAtFor(event: VisualEvent, ctx: TimeContext): number {
  const resolved = resolveAnchorSec(event.start, ctx);
  return resolved !== null ? resolved : ctx.nowSec;
}

export function collectDue(
  tl: PerformanceTimeline,
  state: SchedulerState,
  ctx: TimeContext,
): { due: DueEvent[]; state: SchedulerState } {
  const firedSet = new Set(state.firedIds);
  const candidates: { due: DueEvent; index: number }[] = [];

  for (let i = 0; i < tl.events.length; i++) {
    const event = tl.events[i]!;
    if (firedSet.has(event.id)) continue;
    if (!isDue(event, ctx)) continue;
    candidates.push({
      due: { event: cloneEvent(event), firedAtSec: firedAtFor(event, ctx) },
      index: i,
    });
  }

  candidates.sort((a, b) => {
    if (a.due.firedAtSec !== b.due.firedAtSec) {
      return a.due.firedAtSec - b.due.firedAtSec;
    }
    return a.index - b.index;
  });

  const due = candidates.map((c) => c.due);
  const newFired = [...state.firedIds, ...due.map((d) => d.event.id)];
  return { due, state: { firedIds: newFired } };
}

export function fireExternal(
  tl: PerformanceTimeline,
  state: SchedulerState,
  externalId: string,
  ctx: TimeContext,
): { due: DueEvent[]; state: SchedulerState } {
  const firedSet = new Set(state.firedIds);
  const due: DueEvent[] = [];

  for (const event of tl.events) {
    if (firedSet.has(event.id)) continue;
    if (event.start.kind !== 'external') continue;
    if (event.start.id !== externalId) continue;
    due.push({ event: cloneEvent(event), firedAtSec: ctx.nowSec });
  }

  if (due.length === 0) {
    return { due, state: { firedIds: [...state.firedIds] } };
  }

  return {
    due,
    state: { firedIds: [...state.firedIds, ...due.map((d) => d.event.id)] },
  };
}
