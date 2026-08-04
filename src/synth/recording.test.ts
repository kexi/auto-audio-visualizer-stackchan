import { describe, expect, it } from 'vitest';
import {
  createRecorder,
  parseRecording,
  replayTimeline,
  serializeRecording,
  type PerformanceRecording,
} from './recording';
import { applyOp, type PerformanceTimeline, type TimeContext, type VisualEvent } from './timeline';
import { DEFAULT_TRANSITION, type VisualPatch } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalPatch(overrides: Partial<VisualPatch> = {}): VisualPatch {
  return {
    schemaVersion: 1,
    seed: 'session',
    operators: [
      {
        id: 'op1',
        generatorId: 'gen',
        generatorVersion: 1,
        parameters: { a: 1 },
      },
    ],
    routes: [],
    palette: { mode: 'mono', hueOffset: 10, saturation: 20, lightness: 30 },
    composition: { symmetry: 2, scale: 1, speed: 1 },
    qualityTier: 'low',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<VisualEvent> & { id: string }): VisualEvent {
  return {
    start: { kind: 'seconds', atSec: 1 },
    duration: { kind: 'untilNext' },
    intent: { label: 'ev' },
    transition: { ...DEFAULT_TRANSITION },
    confidence: 0.8,
    locked: false,
    ...overrides,
  };
}

function replayCtx(nowSec: number): TimeContext {
  return {
    nowSec,
    barCount: 0,
    barPhase: 0,
    bpm: 0,
    tempoLocked: false,
  };
}

function buildExpectedTimeline(): PerformanceTimeline {
  let tl: PerformanceTimeline = { lockedUntilSec: 0, events: [] };
  const ops = [
    {
      atSec: 0,
      op: {
        op: 'add' as const,
        event: makeEvent({ id: 'e1', start: { kind: 'seconds', atSec: 1 } }),
      },
    },
    {
      atSec: 0.5,
      op: {
        op: 'add' as const,
        event: makeEvent({ id: 'e2', start: { kind: 'seconds', atSec: 3 } }),
      },
    },
    { atSec: 1, op: { op: 'setLockedUntil' as const, sec: 2 } },
    {
      atSec: 2,
      op: {
        op: 'setIntent' as const,
        id: 'e2',
        intent: { label: 'updated', seed: 'x' },
      },
    },
  ];
  for (const { atSec, op } of ops) {
    const r = applyOp(tl, op, replayCtx(atSec));
    expect(r.ok).toBe(true);
    tl = r.timeline;
  }
  return tl;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createRecorder', () => {
  it('records ops and fired, snapshot is deep-ish copy', () => {
    const recorder = createRecorder('1.0.0', 'seed-abc', minimalPatch());
    recorder.recordOp(0, {
      op: 'add',
      event: makeEvent({ id: 'e1' }),
    });
    recorder.recordFired(1.2, 'e1');

    const snap = recorder.snapshot();
    expect(snap.schemaVersion).toBe(1);
    expect(snap.engineVersion).toBe('1.0.0');
    expect(snap.sessionSeed).toBe('seed-abc');
    expect(snap.ops).toHaveLength(1);
    expect(snap.fired).toEqual([{ atSec: 1.2, eventId: 'e1' }]);

    recorder.recordOp(2, { op: 'setLockedUntil', sec: 5 });
    expect(snap.ops).toHaveLength(1); // previous snapshot unaffected

    const snap2 = recorder.snapshot();
    expect(snap2.ops).toHaveLength(2);
  });
});

describe('serializeRecording / parseRecording', () => {
  it('round-trips deterministically with replay', () => {
    const recorder = createRecorder('engine-1', 'sess-1', minimalPatch({ seed: 's1' }));
    recorder.recordOp(0, {
      op: 'add',
      event: makeEvent({ id: 'e1', start: { kind: 'seconds', atSec: 1 } }),
    });
    recorder.recordOp(0.5, {
      op: 'add',
      event: makeEvent({ id: 'e2', start: { kind: 'seconds', atSec: 3 } }),
    });
    recorder.recordOp(1, { op: 'setLockedUntil', sec: 2 });
    recorder.recordOp(2, {
      op: 'setIntent',
      id: 'e2',
      intent: { label: 'updated', seed: 'x' },
    });
    recorder.recordFired(1, 'e1');

    const snap = recorder.snapshot();
    const json = serializeRecording(snap);
    const parsed = parseRecording(JSON.parse(json));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const expected = buildExpectedTimeline();
    const replayed = replayTimeline(parsed.rec, Number.POSITIVE_INFINITY);
    expect(replayed).toEqual(expected);

    // serialize again is identical
    expect(serializeRecording(parsed.rec)).toBe(json);
  });

  it('serializeRecording is independent of property insertion order', () => {
    const base: PerformanceRecording = {
      schemaVersion: 1,
      engineVersion: 'e',
      sessionSeed: 's',
      initialPatch: minimalPatch(),
      ops: [
        {
          atSec: 1,
          op: {
            op: 'add',
            event: makeEvent({
              id: 'e1',
              start: { kind: 'seconds', atSec: 2 },
              duration: { kind: 'seconds', sec: 1 },
            }),
          },
        },
      ],
      fired: [{ atSec: 2, eventId: 'e1' }],
    };

    const reordered = JSON.parse(
      JSON.stringify({
        fired: base.fired,
        ops: [
          {
            op: {
              event: {
                locked: false,
                confidence: 0.8,
                transition: {
                  easing: DEFAULT_TRANSITION.easing,
                  topologyMs: DEFAULT_TRANSITION.topologyMs,
                  modulationMs: DEFAULT_TRANSITION.modulationMs,
                  parameterMs: DEFAULT_TRANSITION.parameterMs,
                  paletteMs: DEFAULT_TRANSITION.paletteMs,
                },
                intent: { label: 'ev' },
                duration: { sec: 1, kind: 'seconds' },
                start: { atSec: 2, kind: 'seconds' },
                id: 'e1',
              },
              op: 'add',
            },
            atSec: 1,
          },
        ],
        initialPatch: {
          qualityTier: base.initialPatch.qualityTier,
          composition: {
            speed: 1,
            scale: 1,
            symmetry: 2,
          },
          palette: {
            lightness: 30,
            saturation: 20,
            hueOffset: 10,
            mode: 'mono',
          },
          routes: [],
          operators: [
            {
              parameters: { a: 1 },
              generatorVersion: 1,
              generatorId: 'gen',
              id: 'op1',
            },
          ],
          seed: 'session',
          schemaVersion: 1,
        },
        sessionSeed: 's',
        engineVersion: 'e',
        schemaVersion: 1,
      }),
    ) as PerformanceRecording;

    expect(serializeRecording(reordered)).toBe(serializeRecording(base));
  });

  it('parseRecording rejects bad input', () => {
    expect(parseRecording(null).ok).toBe(false);
    expect(parseRecording({}).ok).toBe(false);
    expect(parseRecording({ schemaVersion: 2 }).ok).toBe(false);

    const bad = {
      schemaVersion: 1,
      engineVersion: 'e',
      sessionSeed: 's',
      initialPatch: minimalPatch(),
      ops: [{ atSec: 'nope', op: { op: 'remove', id: 'x' } }],
      fired: [],
    };
    const r = parseRecording(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.length).toBeGreaterThan(0);
    }

    const badOp = {
      schemaVersion: 1,
      engineVersion: 'e',
      sessionSeed: 's',
      initialPatch: minimalPatch(),
      ops: [{ atSec: 0, op: { op: 'unknown' } }],
      fired: [],
    };
    expect(parseRecording(badOp).ok).toBe(false);

    const badConfidence = {
      schemaVersion: 1,
      engineVersion: 'e',
      sessionSeed: 's',
      initialPatch: minimalPatch(),
      ops: [
        {
          atSec: 0,
          op: {
            op: 'add',
            event: makeEvent({ id: 'e1', confidence: 2 }),
          },
        },
      ],
      fired: [],
    };
    expect(parseRecording(badConfidence).ok).toBe(false);
  });
});

describe('replayTimeline', () => {
  it('returns intermediate state for uptoSec', () => {
    const recorder = createRecorder('e', 's', minimalPatch());
    recorder.recordOp(0, {
      op: 'add',
      event: makeEvent({ id: 'e1', start: { kind: 'seconds', atSec: 1 } }),
    });
    recorder.recordOp(0.5, {
      op: 'add',
      event: makeEvent({ id: 'e2', start: { kind: 'seconds', atSec: 3 } }),
    });
    recorder.recordOp(1, { op: 'setLockedUntil', sec: 2 });
    recorder.recordOp(2, {
      op: 'setIntent',
      id: 'e2',
      intent: { label: 'updated', seed: 'x' },
    });
    const rec = recorder.snapshot();

    const at0 = replayTimeline(rec, 0);
    expect(at0.events.map((e) => e.id)).toEqual(['e1']);
    expect(at0.lockedUntilSec).toBe(0);

    const at0_5 = replayTimeline(rec, 0.5);
    expect(at0_5.events.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(at0_5.lockedUntilSec).toBe(0);

    const at1 = replayTimeline(rec, 1);
    expect(at1.events.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(at1.lockedUntilSec).toBe(2);
    expect(at1.events.find((e) => e.id === 'e2')!.intent.label).toBe('ev');

    const at2 = replayTimeline(rec, 2);
    expect(at2.events.find((e) => e.id === 'e2')!.intent).toEqual({
      label: 'updated',
      seed: 'x',
    });
  });

  it('skips failed ops and keeps last good timeline', () => {
    const rec: PerformanceRecording = {
      schemaVersion: 1,
      engineVersion: 'e',
      sessionSeed: 's',
      initialPatch: minimalPatch(),
      ops: [
        {
          atSec: 0,
          op: { op: 'add', event: makeEvent({ id: 'e1' }) },
        },
        {
          atSec: 1,
          op: { op: 'remove', id: 'missing' }, // fails
        },
        {
          atSec: 2,
          op: { op: 'setLockedUntil', sec: 9 },
        },
      ],
      fired: [],
    };
    const tl = replayTimeline(rec, 10);
    expect(tl.events.map((e) => e.id)).toEqual(['e1']);
    expect(tl.lockedUntilSec).toBe(9);
  });

  it('applies equal atSec ops in array order (stable)', () => {
    const rec: PerformanceRecording = {
      schemaVersion: 1,
      engineVersion: 'e',
      sessionSeed: 's',
      initialPatch: minimalPatch(),
      ops: [
        {
          atSec: 1,
          op: { op: 'add', event: makeEvent({ id: 'second' }) },
        },
        {
          atSec: 0,
          op: { op: 'add', event: makeEvent({ id: 'first' }) },
        },
        {
          atSec: 1,
          op: { op: 'setIntent', id: 'second', intent: { label: 'done' } },
        },
      ],
      fired: [],
    };
    const tl = replayTimeline(rec, 1);
    expect(tl.events.map((e) => e.id)).toEqual(['first', 'second']);
    expect(tl.events[1]!.intent.label).toBe('done');
  });
});
