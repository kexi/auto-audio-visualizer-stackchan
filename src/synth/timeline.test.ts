import { describe, expect, it } from 'vitest';
import type { AudioFrame } from '../audio/types';
import { DEFAULT_TRANSITION } from './types';
import {
  applyOp,
  collectDue,
  createSchedulerState,
  fireExternal,
  resolveAnchorSec,
  timeContextFrom,
  type PerformanceTimeline,
  type TimeContext,
  type VisualEvent,
} from './timeline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<VisualEvent> & { id: string }): VisualEvent {
  return {
    start: { kind: 'seconds', atSec: 1 },
    duration: { kind: 'seconds', sec: 2 },
    intent: { label: 'test' },
    transition: { ...DEFAULT_TRANSITION },
    confidence: 1,
    locked: false,
    ...overrides,
  };
}

function emptyTl(lockedUntilSec = 0): PerformanceTimeline {
  return { lockedUntilSec, events: [] };
}

function ctx(overrides: Partial<TimeContext> = {}): TimeContext {
  return {
    nowSec: 0,
    barCount: 0,
    barPhase: 0,
    bpm: 120,
    tempoLocked: true,
    ...overrides,
  };
}

function snap(tl: PerformanceTimeline): string {
  return JSON.stringify(tl);
}

// ---------------------------------------------------------------------------
// applyOp — success paths
// ---------------------------------------------------------------------------

describe('applyOp', () => {
  describe('success cases', () => {
    it('add inserts an event', () => {
      const event = makeEvent({ id: 'e1', start: { kind: 'seconds', atSec: 5 } });
      const result = applyOp(emptyTl(), { op: 'add', event }, ctx());
      expect(result.ok).toBe(true);
      expect(result.timeline.events).toHaveLength(1);
      expect(result.timeline.events[0]!.id).toBe('e1');
    });

    it('replace swaps an existing event (same id)', () => {
      const e1 = makeEvent({ id: 'e1', confidence: 0.5 });
      let tl = applyOp(emptyTl(), { op: 'add', event: e1 }, ctx()).timeline;
      const e1b = makeEvent({ id: 'e1', confidence: 0.9, intent: { label: 'new' } });
      const result = applyOp(tl, { op: 'replace', id: 'e1', event: e1b }, ctx());
      expect(result.ok).toBe(true);
      expect(result.timeline.events[0]!.confidence).toBe(0.9);
      expect(result.timeline.events[0]!.intent.label).toBe('new');
    });

    it('remove deletes an event', () => {
      const e1 = makeEvent({ id: 'e1' });
      let tl = applyOp(emptyTl(), { op: 'add', event: e1 }, ctx()).timeline;
      const result = applyOp(tl, { op: 'remove', id: 'e1' }, ctx());
      expect(result.ok).toBe(true);
      expect(result.timeline.events).toHaveLength(0);
    });

    it('setIntent updates intent only', () => {
      const e1 = makeEvent({ id: 'e1', intent: { label: 'old' } });
      let tl = applyOp(emptyTl(), { op: 'add', event: e1 }, ctx()).timeline;
      const result = applyOp(
        tl,
        { op: 'setIntent', id: 'e1', intent: { label: 'new', seed: 's' } },
        ctx(),
      );
      expect(result.ok).toBe(true);
      expect(result.timeline.events[0]!.intent).toEqual({ label: 'new', seed: 's' });
      expect(result.timeline.events[0]!.confidence).toBe(1);
    });

    it('setTransition updates transition only', () => {
      const e1 = makeEvent({ id: 'e1' });
      let tl = applyOp(emptyTl(), { op: 'add', event: e1 }, ctx()).timeline;
      const next = {
        paletteMs: 100,
        parameterMs: 200,
        modulationMs: 300,
        topologyMs: 400,
        easing: 'linear' as const,
      };
      const result = applyOp(tl, { op: 'setTransition', id: 'e1', transition: next }, ctx());
      expect(result.ok).toBe(true);
      expect(result.timeline.events[0]!.transition).toEqual(next);
    });

    it('shift updates start anchor', () => {
      const e1 = makeEvent({ id: 'e1', start: { kind: 'seconds', atSec: 1 } });
      let tl = applyOp(emptyTl(), { op: 'add', event: e1 }, ctx()).timeline;
      const result = applyOp(
        tl,
        { op: 'shift', id: 'e1', anchor: { kind: 'seconds', atSec: 10 } },
        ctx({ nowSec: 0 }),
      );
      expect(result.ok).toBe(true);
      expect(result.timeline.events[0]!.start).toEqual({ kind: 'seconds', atSec: 10 });
    });

    it('setLockedUntil updates lockedUntilSec', () => {
      const result = applyOp(emptyTl(), { op: 'setLockedUntil', sec: 12.5 }, ctx());
      expect(result.ok).toBe(true);
      expect(result.timeline.lockedUntilSec).toBe(12.5);
    });

    it('add may insert events before lockedUntilSec', () => {
      const tl = emptyTl(100);
      const event = makeEvent({ id: 'past', start: { kind: 'seconds', atSec: 1 } });
      const result = applyOp(tl, { op: 'add', event }, ctx({ nowSec: 200 }));
      expect(result.ok).toBe(true);
      expect(result.timeline.events).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Protection / rejection
  // -------------------------------------------------------------------------

  describe('protection rejects', () => {
    it('rejects modify when event.locked === true', () => {
      const e1 = makeEvent({ id: 'e1', locked: true, start: { kind: 'seconds', atSec: 50 } });
      const tl = applyOp(emptyTl(), { op: 'add', event: e1 }, ctx()).timeline;
      const c = ctx({ nowSec: 0 });

      expect(applyOp(tl, { op: 'remove', id: 'e1' }, c).ok).toBe(false);
      expect(applyOp(tl, { op: 'setIntent', id: 'e1', intent: { label: 'x' } }, c).ok).toBe(false);
      expect(
        applyOp(tl, { op: 'setTransition', id: 'e1', transition: DEFAULT_TRANSITION }, c).ok,
      ).toBe(false);
      expect(
        applyOp(tl, { op: 'shift', id: 'e1', anchor: { kind: 'seconds', atSec: 60 } }, c).ok,
      ).toBe(false);
      expect(
        applyOp(tl, { op: 'replace', id: 'e1', event: makeEvent({ id: 'e1', locked: false }) }, c)
          .ok,
      ).toBe(false);

      for (const r of [
        applyOp(tl, { op: 'remove', id: 'e1' }, c),
        applyOp(tl, { op: 'setIntent', id: 'e1', intent: {} }, c),
      ]) {
        expect(r.timeline).toBe(tl);
        expect(r.issue).toMatch(/locked/);
      }
    });

    it('rejects modify when fire time is strictly before lockedUntilSec', () => {
      const e1 = makeEvent({ id: 'e1', start: { kind: 'seconds', atSec: 5 } });
      let tl = applyOp(emptyTl(), { op: 'add', event: e1 }, ctx()).timeline;
      tl = applyOp(tl, { op: 'setLockedUntil', sec: 10 }, ctx()).timeline;
      const c = ctx({ nowSec: 20 });

      const remove = applyOp(tl, { op: 'remove', id: 'e1' }, c);
      expect(remove.ok).toBe(false);
      expect(remove.timeline).toBe(tl);
      expect(remove.issue).toMatch(/lockedUntilSec/);

      // boundary: fire time === lockedUntilSec is allowed
      const e2 = makeEvent({ id: 'e2', start: { kind: 'seconds', atSec: 10 } });
      tl = applyOp(tl, { op: 'add', event: e2 }, c).timeline;
      const okRemove = applyOp(tl, { op: 'remove', id: 'e2' }, c);
      expect(okRemove.ok).toBe(true);
    });

    it('rejects shift when new anchor resolves before lockedUntilSec', () => {
      const e1 = makeEvent({ id: 'e1', start: { kind: 'seconds', atSec: 50 } });
      let tl = applyOp(emptyTl(20), { op: 'add', event: e1 }, ctx()).timeline;
      const result = applyOp(
        tl,
        { op: 'shift', id: 'e1', anchor: { kind: 'seconds', atSec: 5 } },
        ctx({ nowSec: 0 }),
      );
      expect(result.ok).toBe(false);
      expect(result.issue).toMatch(/before lockedUntilSec/);
      expect(result.timeline).toBe(tl);
    });

    it('rejects unknown id', () => {
      const tl = emptyTl();
      const result = applyOp(tl, { op: 'remove', id: 'missing' }, ctx());
      expect(result.ok).toBe(false);
      expect(result.issue).toMatch(/unknown/);
      expect(result.timeline).toBe(tl);
    });

    it('rejects add with duplicate id', () => {
      const e1 = makeEvent({ id: 'e1' });
      const tl = applyOp(emptyTl(), { op: 'add', event: e1 }, ctx()).timeline;
      const result = applyOp(tl, { op: 'add', event: makeEvent({ id: 'e1' }) }, ctx());
      expect(result.ok).toBe(false);
      expect(result.issue).toMatch(/duplicate/);
      expect(result.timeline).toBe(tl);
    });

    it('rejects replace when event.id !== target id', () => {
      const e1 = makeEvent({ id: 'e1' });
      const tl = applyOp(emptyTl(), { op: 'add', event: e1 }, ctx()).timeline;
      const result = applyOp(
        tl,
        { op: 'replace', id: 'e1', event: makeEvent({ id: 'other' }) },
        ctx(),
      );
      expect(result.ok).toBe(false);
      expect(result.issue).toMatch(/must equal/);
    });

    it('rejects invalid values', () => {
      const tl = emptyTl();
      const c = ctx();

      expect(
        applyOp(
          tl,
          { op: 'add', event: makeEvent({ id: '', start: { kind: 'seconds', atSec: 1 } }) },
          c,
        ).ok,
      ).toBe(false);

      expect(
        applyOp(
          tl,
          {
            op: 'add',
            event: makeEvent({ id: 'bad', confidence: 1.5 }),
          },
          c,
        ).ok,
      ).toBe(false);

      expect(
        applyOp(
          tl,
          {
            op: 'add',
            event: makeEvent({ id: 'nan', start: { kind: 'seconds', atSec: Number.NaN } }),
          },
          c,
        ).ok,
      ).toBe(false);

      expect(applyOp(tl, { op: 'setLockedUntil', sec: Number.NaN }, c).ok).toBe(false);
      expect(applyOp(tl, { op: 'setLockedUntil', sec: Number.POSITIVE_INFINITY }, c).ok).toBe(
        false,
      );

      const withEvent = applyOp(tl, { op: 'add', event: makeEvent({ id: 'e1' }) }, c).timeline;
      expect(
        applyOp(
          withEvent,
          {
            op: 'setTransition',
            id: 'e1',
            transition: { ...DEFAULT_TRANSITION, paletteMs: Number.NaN },
          },
          c,
        ).ok,
      ).toBe(false);
    });

    it('setLockedUntil is always allowed for finite sec (even with locked events)', () => {
      const e1 = makeEvent({ id: 'e1', locked: true });
      const tl = applyOp(emptyTl(), { op: 'add', event: e1 }, ctx()).timeline;
      const result = applyOp(tl, { op: 'setLockedUntil', sec: 99 }, ctx());
      expect(result.ok).toBe(true);
      expect(result.timeline.lockedUntilSec).toBe(99);
    });
  });

  // -------------------------------------------------------------------------
  // Immutability
  // -------------------------------------------------------------------------

  describe('immutability', () => {
    it('does not mutate input timeline on success', () => {
      const e1 = makeEvent({ id: 'e1' });
      const tl = emptyTl();
      const before = snap(tl);
      const result = applyOp(tl, { op: 'add', event: e1 }, ctx());
      expect(result.ok).toBe(true);
      expect(snap(tl)).toBe(before);
      expect(result.timeline).not.toBe(tl);
      expect(result.timeline.events).not.toBe(tl.events);
    });

    it('returns same timeline reference on failure', () => {
      const tl = emptyTl();
      const result = applyOp(tl, { op: 'remove', id: 'nope' }, ctx());
      expect(result.ok).toBe(false);
      expect(result.timeline).toBe(tl);
    });

    it('clones nested event fields so later mutation of input does not affect timeline', () => {
      const event = makeEvent({ id: 'e1', intent: { label: 'a' } });
      const result = applyOp(emptyTl(), { op: 'add', event }, ctx());
      event.intent.label = 'mutated';
      event.confidence = 0;
      expect(result.timeline.events[0]!.intent.label).toBe('a');
      expect(result.timeline.events[0]!.confidence).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// resolveAnchorSec / timeContextFrom
// ---------------------------------------------------------------------------

describe('resolveAnchorSec', () => {
  it('resolves seconds to atSec', () => {
    expect(resolveAnchorSec({ kind: 'seconds', atSec: 3.5 }, ctx())).toBe(3.5);
  });

  it('resolves bar with tempo lock', () => {
    // secPerBar = 240/120 = 2
    // nowSec + (bar - barCount - barPhase) * 2
    const c = ctx({ nowSec: 10, barCount: 2, barPhase: 0.25, bpm: 120, tempoLocked: true });
    // bar 4: 10 + (4 - 2 - 0.25) * 2 = 10 + 1.75*2 = 13.5
    expect(resolveAnchorSec({ kind: 'bar', bar: 4 }, c)).toBeCloseTo(13.5, 10);
  });

  it('returns null for bar when bpm=0 or !tempoLocked', () => {
    expect(resolveAnchorSec({ kind: 'bar', bar: 1 }, ctx({ bpm: 0, tempoLocked: true }))).toBe(
      null,
    );
    expect(resolveAnchorSec({ kind: 'bar', bar: 1 }, ctx({ bpm: 120, tempoLocked: false }))).toBe(
      null,
    );
  });

  it('returns null for external', () => {
    expect(resolveAnchorSec({ kind: 'external', id: 'cue-1' }, ctx())).toBe(null);
  });
});

describe('timeContextFrom', () => {
  it('maps audio frame fields and tSec', () => {
    const audio = {
      bpm: 128,
      barCount: 3,
      barPhase: 0.5,
      tempoLocked: true,
    } as AudioFrame;
    const c = timeContextFrom(audio, 42);
    expect(c).toEqual({
      nowSec: 42,
      barCount: 3,
      barPhase: 0.5,
      bpm: 128,
      tempoLocked: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

describe('collectDue / fireExternal', () => {
  it('fires seconds anchors when nowSec >= atSec', () => {
    const e1 = makeEvent({ id: 'e1', start: { kind: 'seconds', atSec: 2 } });
    const e2 = makeEvent({ id: 'e2', start: { kind: 'seconds', atSec: 5 } });
    let tl = emptyTl();
    tl = applyOp(tl, { op: 'add', event: e1 }, ctx()).timeline;
    tl = applyOp(tl, { op: 'add', event: e2 }, ctx()).timeline;

    const state0 = createSchedulerState();
    const r1 = collectDue(tl, state0, ctx({ nowSec: 2 }));
    expect(r1.due.map((d) => d.event.id)).toEqual(['e1']);
    expect(r1.due[0]!.firedAtSec).toBe(2);
    expect(state0.firedIds).toEqual([]); // input unchanged

    const r2 = collectDue(tl, r1.state, ctx({ nowSec: 10 }));
    expect(r2.due.map((d) => d.event.id)).toEqual(['e2']);
  });

  it('fires bar anchors when barCount crosses threshold', () => {
    const e1 = makeEvent({ id: 'bar5', start: { kind: 'bar', bar: 5 } });
    const tl = applyOp(emptyTl(), { op: 'add', event: e1 }, ctx()).timeline;
    const state = createSchedulerState();

    const held = collectDue(
      tl,
      state,
      ctx({ nowSec: 10, barCount: 4, barPhase: 0.9, bpm: 120, tempoLocked: true }),
    );
    expect(held.due).toHaveLength(0);

    const fired = collectDue(
      tl,
      held.state,
      ctx({ nowSec: 10.2, barCount: 5, barPhase: 0.05, bpm: 120, tempoLocked: true }),
    );
    expect(fired.due).toHaveLength(1);
    expect(fired.due[0]!.event.id).toBe('bar5');
    // firedAtSec = 10.2 + (5 - 5 - 0.05) * (240/120) = 10.2 - 0.1 = 10.1
    expect(fired.due[0]!.firedAtSec).toBeCloseTo(10.1, 10);
  });

  it('holds bar anchors when bpm=0 (no error)', () => {
    const e1 = makeEvent({ id: 'bar1', start: { kind: 'bar', bar: 0 } });
    const tl = applyOp(emptyTl(), { op: 'add', event: e1 }, ctx()).timeline;
    const r = collectDue(
      tl,
      createSchedulerState(),
      ctx({ nowSec: 5, barCount: 10, bpm: 0, tempoLocked: true }),
    );
    expect(r.due).toHaveLength(0);
  });

  it('holds bar anchors when !tempoLocked', () => {
    const e1 = makeEvent({ id: 'bar1', start: { kind: 'bar', bar: 0 } });
    const tl = applyOp(emptyTl(), { op: 'add', event: e1 }, ctx()).timeline;
    const r = collectDue(
      tl,
      createSchedulerState(),
      ctx({ nowSec: 5, barCount: 10, bpm: 120, tempoLocked: false }),
    );
    expect(r.due).toHaveLength(0);
  });

  it('never double-fires the same id', () => {
    const e1 = makeEvent({ id: 'e1', start: { kind: 'seconds', atSec: 1 } });
    const tl = applyOp(emptyTl(), { op: 'add', event: e1 }, ctx()).timeline;
    const r1 = collectDue(tl, createSchedulerState(), ctx({ nowSec: 2 }));
    expect(r1.due).toHaveLength(1);
    const r2 = collectDue(tl, r1.state, ctx({ nowSec: 3 }));
    expect(r2.due).toHaveLength(0);
    expect(r2.state.firedIds).toEqual(['e1']);
  });

  it('does not auto-fire external in collectDue', () => {
    const e1 = makeEvent({ id: 'ext', start: { kind: 'external', id: 'cue-a' } });
    const tl = applyOp(emptyTl(), { op: 'add', event: e1 }, ctx()).timeline;
    const r = collectDue(tl, createSchedulerState(), ctx({ nowSec: 100 }));
    expect(r.due).toHaveLength(0);
  });

  it('fireExternal fires matching unfired external events', () => {
    const a = makeEvent({ id: 'a', start: { kind: 'external', id: 'cue-1' } });
    const b = makeEvent({ id: 'b', start: { kind: 'external', id: 'cue-2' } });
    const c = makeEvent({ id: 'c', start: { kind: 'external', id: 'cue-1' } });
    let tl = emptyTl();
    tl = applyOp(tl, { op: 'add', event: a }, ctx()).timeline;
    tl = applyOp(tl, { op: 'add', event: b }, ctx()).timeline;
    tl = applyOp(tl, { op: 'add', event: c }, ctx()).timeline;

    const state0 = createSchedulerState();
    const r = fireExternal(tl, state0, 'cue-1', ctx({ nowSec: 7 }));
    expect(r.due.map((d) => d.event.id)).toEqual(['a', 'c']);
    expect(r.due.every((d) => d.firedAtSec === 7)).toBe(true);
    expect(state0.firedIds).toEqual([]);

    const again = fireExternal(tl, r.state, 'cue-1', ctx({ nowSec: 8 }));
    expect(again.due).toHaveLength(0);

    const other = fireExternal(tl, r.state, 'cue-2', ctx({ nowSec: 9 }));
    expect(other.due.map((d) => d.event.id)).toEqual(['b']);
  });

  it('same-time events fire in array order (stable), sorted by firedAtSec then index', () => {
    const late = makeEvent({ id: 'late', start: { kind: 'seconds', atSec: 3 } });
    const earlyA = makeEvent({ id: 'earlyA', start: { kind: 'seconds', atSec: 1 } });
    const earlyB = makeEvent({ id: 'earlyB', start: { kind: 'seconds', atSec: 1 } });
    let tl = emptyTl();
    // insertion order: late, earlyA, earlyB
    tl = applyOp(tl, { op: 'add', event: late }, ctx()).timeline;
    tl = applyOp(tl, { op: 'add', event: earlyA }, ctx()).timeline;
    tl = applyOp(tl, { op: 'add', event: earlyB }, ctx()).timeline;

    const r = collectDue(tl, createSchedulerState(), ctx({ nowSec: 10 }));
    expect(r.due.map((d) => d.event.id)).toEqual(['earlyA', 'earlyB', 'late']);
    expect(r.due.map((d) => d.firedAtSec)).toEqual([1, 1, 3]);
  });
});
