import * as v from 'valibot';
import { visualPatchSchema } from './schema';
import { applyOp, type PerformanceTimeline, type TimelineOp, type TimeContext } from './timeline';
import type { VisualPatch } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimestampedOp {
  atSec: number;
  op: TimelineOp;
}

export interface FiredRecord {
  atSec: number;
  eventId: string;
}

export interface PerformanceRecording {
  schemaVersion: 1;
  engineVersion: string;
  sessionSeed: string;
  initialPatch: VisualPatch;
  ops: TimestampedOp[];
  fired: FiredRecord[];
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

export function createRecorder(
  engineVersion: string,
  sessionSeed: string,
  initialPatch: VisualPatch,
): {
  recordOp(atSec: number, op: TimelineOp): void;
  recordFired(atSec: number, eventId: string): void;
  snapshot(): PerformanceRecording;
} {
  const ops: TimestampedOp[] = [];
  const fired: FiredRecord[] = [];
  const patch = structuredClone(initialPatch);

  return {
    recordOp(atSec: number, op: TimelineOp): void {
      ops.push({ atSec, op: structuredClone(op) });
    },
    recordFired(atSec: number, eventId: string): void {
      fired.push({ atSec, eventId });
    },
    snapshot(): PerformanceRecording {
      return {
        schemaVersion: 1,
        engineVersion,
        sessionSeed,
        initialPatch: structuredClone(patch),
        ops: structuredClone(ops),
        fired: structuredClone(fired),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Serialization (local sortKeysDeep — do not import private fn from schema)
// ---------------------------------------------------------------------------

/** Recursively sort object keys for deterministic JSON serialization. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = sortKeysDeep(obj[k]);
    }
    return sorted;
  }
  return value;
}

export function serializeRecording(rec: PerformanceRecording): string {
  return JSON.stringify(sortKeysDeep(rec));
}

// ---------------------------------------------------------------------------
// Valibot schemas
// ---------------------------------------------------------------------------

const transitionSchema = v.object({
  paletteMs: v.pipe(v.number(), v.finite()),
  parameterMs: v.pipe(v.number(), v.finite()),
  modulationMs: v.pipe(v.number(), v.finite()),
  topologyMs: v.pipe(v.number(), v.finite()),
  easing: v.picklist(['linear', 'easeInOut']),
});

const timeAnchorSchema = v.variant('kind', [
  v.object({
    kind: v.literal('seconds'),
    atSec: v.pipe(v.number(), v.finite()),
  }),
  v.object({
    kind: v.literal('bar'),
    bar: v.pipe(v.number(), v.finite()),
  }),
  v.object({
    kind: v.literal('external'),
    id: v.pipe(v.string(), v.minLength(1)),
  }),
]);

const durationSpecSchema = v.variant('kind', [
  v.object({
    kind: v.literal('seconds'),
    sec: v.pipe(v.number(), v.finite()),
  }),
  v.object({
    kind: v.literal('bars'),
    bars: v.pipe(v.number(), v.finite()),
  }),
  v.object({
    kind: v.literal('untilNext'),
  }),
]);

const semanticIntentSchema = v.object({
  label: v.optional(v.string()),
  seed: v.optional(v.string()),
  patch: v.optional(visualPatchSchema),
});

const visualEventSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  start: timeAnchorSchema,
  duration: durationSpecSchema,
  intent: semanticIntentSchema,
  transition: transitionSchema,
  confidence: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1)),
  locked: v.boolean(),
});

const timelineOpSchema = v.variant('op', [
  v.object({
    op: v.literal('add'),
    event: visualEventSchema,
  }),
  v.object({
    op: v.literal('replace'),
    id: v.pipe(v.string(), v.minLength(1)),
    event: visualEventSchema,
  }),
  v.object({
    op: v.literal('remove'),
    id: v.pipe(v.string(), v.minLength(1)),
  }),
  v.object({
    op: v.literal('setIntent'),
    id: v.pipe(v.string(), v.minLength(1)),
    intent: semanticIntentSchema,
  }),
  v.object({
    op: v.literal('setTransition'),
    id: v.pipe(v.string(), v.minLength(1)),
    transition: transitionSchema,
  }),
  v.object({
    op: v.literal('shift'),
    id: v.pipe(v.string(), v.minLength(1)),
    anchor: timeAnchorSchema,
  }),
  v.object({
    op: v.literal('setLockedUntil'),
    sec: v.pipe(v.number(), v.finite()),
  }),
]);

const timestampedOpSchema = v.object({
  atSec: v.pipe(v.number(), v.finite()),
  op: timelineOpSchema,
});

const firedRecordSchema = v.object({
  atSec: v.pipe(v.number(), v.finite()),
  eventId: v.pipe(v.string(), v.minLength(1)),
});

const performanceRecordingSchema = v.object({
  schemaVersion: v.literal(1),
  engineVersion: v.string(),
  sessionSeed: v.string(),
  initialPatch: visualPatchSchema,
  ops: v.array(timestampedOpSchema),
  fired: v.array(firedRecordSchema),
});

export function parseRecording(
  input: unknown,
): { ok: true; rec: PerformanceRecording } | { ok: false; issues: string[] } {
  const result = v.safeParse(performanceRecordingSchema, input);
  if (!result.success) {
    const issues = result.issues.map((issue) => {
      const path =
        issue.path && issue.path.length > 0
          ? issue.path.map((p) => String(p.key)).join('.')
          : '(root)';
      return `${path}: ${issue.message}`;
    });
    return { ok: false, issues };
  }
  return { ok: true, rec: result.output as PerformanceRecording };
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

const REPLAY_CTX_BASE: Omit<TimeContext, 'nowSec'> = {
  barCount: 0,
  barPhase: 0,
  bpm: 0,
  tempoLocked: false,
};

/**
 * Rebuild a PerformanceTimeline by applying ops with atSec <= uptoSec.
 * Failed ops are skipped (last good timeline is kept).
 */
export function replayTimeline(rec: PerformanceRecording, uptoSec: number): PerformanceTimeline {
  let tl: PerformanceTimeline = { lockedUntilSec: 0, events: [] };

  const eligible = rec.ops
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.atSec <= uptoSec)
    .sort((a, b) => {
      if (a.entry.atSec !== b.entry.atSec) return a.entry.atSec - b.entry.atSec;
      return a.index - b.index;
    });

  for (const { entry } of eligible) {
    const ctx: TimeContext = { ...REPLAY_CTX_BASE, nowSec: entry.atSec };
    const result = applyOp(tl, entry.op, ctx);
    if (result.ok) {
      tl = result.timeline;
    }
    // failed ops are skipped silently
  }

  return tl;
}
