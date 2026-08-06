import { describe, expect, it } from 'vitest';
import {
  CLIP_HOLD_MS,
  CLIP_THRESHOLD,
  DB_FLOOR,
  dbToFraction,
  INITIAL_CLIP_LATCH,
  INITIAL_NO_SIGNAL,
  INITIAL_PEAK_HOLD,
  NO_SIGNAL_MS,
  nextClipLatch,
  nextNoSignal,
  nextPeakHold,
  PEAK_HOLD_MS,
  SILENCE_PEAK_THRESHOLD,
  toDb,
} from './meter';

describe('toDb', () => {
  it('converts full-scale amplitude to 0 dB', () => {
    expect(toDb(1)).toBe(0);
  });

  it('clamps zero to the floor instead of -Infinity', () => {
    expect(toDb(0)).toBe(DB_FLOOR);
    expect(Number.isFinite(toDb(0))).toBe(true);
  });

  it('clamps negative input to the floor', () => {
    expect(toDb(-0.5)).toBe(DB_FLOOR);
  });

  it('matches 20*log10 for a mid-scale amplitude', () => {
    expect(toDb(0.5)).toBeCloseTo(20 * Math.log10(0.5), 10);
  });

  it('clamps very quiet signals to the floor', () => {
    // 20*log10(0.0001) = -80dB, well past the -60dB floor.
    expect(toDb(0.0001)).toBe(DB_FLOOR);
  });

  it('lands exactly on the floor at the boundary amplitude', () => {
    // 20*log10(0.001) === -60 exactly.
    expect(toDb(0.001)).toBeCloseTo(DB_FLOOR, 10);
  });
});

describe('dbToFraction', () => {
  it('maps the floor to 0', () => {
    expect(dbToFraction(DB_FLOOR)).toBe(0);
  });

  it('maps 0dB to 1', () => {
    expect(dbToFraction(0)).toBe(1);
  });

  it('maps the midpoint to 0.5', () => {
    expect(dbToFraction(-30)).toBeCloseTo(0.5, 10);
  });

  it('clamps below the floor to 0', () => {
    expect(dbToFraction(-120)).toBe(0);
  });

  it('clamps above the ceiling to 1', () => {
    expect(dbToFraction(10)).toBe(1);
  });
});

describe('nextPeakHold', () => {
  it('tracks a rising peak immediately', () => {
    const next = nextPeakHold(INITIAL_PEAK_HOLD, 0.6, 1000);
    expect(next.value).toBe(0.6);
    expect(next.peakAtMs).toBe(1000);
  });

  it('holds the peak steady while the signal falls, within the hold window', () => {
    const peaked = nextPeakHold(INITIAL_PEAK_HOLD, 0.8, 1000);
    const held = nextPeakHold(peaked, 0.1, 1000 + PEAK_HOLD_MS - 1);
    expect(held.value).toBe(0.8);
  });

  it('decays at the fixed rate once the hold window elapses', () => {
    const peaked = nextPeakHold(INITIAL_PEAK_HOLD, 0.8, 1000);
    // Right at the edge of the hold window: still held.
    const atEdge = nextPeakHold(peaked, 0, 1000 + PEAK_HOLD_MS);
    expect(atEdge.value).toBeCloseTo(0.8, 10);
    // 500ms further into decay from atEdge (dt is measured from updatedAtMs).
    const decaying = nextPeakHold(atEdge, 0, 1000 + PEAK_HOLD_MS + 500);
    expect(decaying.value).toBeCloseTo(0.8 - 0.7 * 0.5, 10);
  });

  it('never decays below the current sample peak — snaps back up on rising signal', () => {
    const peaked = nextPeakHold(INITIAL_PEAK_HOLD, 0.8, 1000);
    const decaying = nextPeakHold(peaked, 0, 1000 + PEAK_HOLD_MS + 2000);
    expect(decaying.value).toBeLessThan(0.8);
    const risingAgain = nextPeakHold(decaying, 0.5, 1000 + PEAK_HOLD_MS + 2001);
    expect(risingAgain.value).toBe(0.5);
  });

  it('does not decay past zero', () => {
    const peaked = nextPeakHold(INITIAL_PEAK_HOLD, 0.3, 0);
    const longAfter = nextPeakHold(peaked, 0, 60_000);
    expect(longAfter.value).toBe(0);
  });
});

describe('nextClipLatch', () => {
  it('lights when the sample peak reaches the clip threshold', () => {
    const next = nextClipLatch(INITIAL_CLIP_LATCH, CLIP_THRESHOLD, 1000);
    expect(next.active).toBe(true);
    expect(next.litAtMs).toBe(1000);
  });

  it('stays unlit below the threshold', () => {
    const next = nextClipLatch(INITIAL_CLIP_LATCH, 0.5, 1000);
    expect(next.active).toBe(false);
  });

  it('stays lit through the hold window even if the peak drops', () => {
    const lit = nextClipLatch(INITIAL_CLIP_LATCH, 1, 1000);
    const stillLit = nextClipLatch(lit, 0.1, 1000 + CLIP_HOLD_MS - 1);
    expect(stillLit.active).toBe(true);
  });

  it('unlatches once the hold window elapses without another clip', () => {
    const lit = nextClipLatch(INITIAL_CLIP_LATCH, 1, 1000);
    const unlit = nextClipLatch(lit, 0.1, 1000 + CLIP_HOLD_MS + 1);
    expect(unlit.active).toBe(false);
  });

  it('re-arms the hold timer on a fresh clip sample', () => {
    const lit = nextClipLatch(INITIAL_CLIP_LATCH, 1, 1000);
    const relit = nextClipLatch(lit, 1, 1000 + CLIP_HOLD_MS - 1);
    expect(relit.litAtMs).toBe(1000 + CLIP_HOLD_MS - 1);
    const stillLit = nextClipLatch(relit, 0.1, 1000 + 2 * CLIP_HOLD_MS - 2);
    expect(stillLit.active).toBe(true);
  });
});

describe('nextNoSignal', () => {
  it('never fires while not running', () => {
    const next = nextNoSignal(INITIAL_NO_SIGNAL, 0, false, 1_000_000);
    expect(next.active).toBe(false);
    expect(next.quietSinceMs).toBe(null);
  });

  it('resets to inactive/null while a signal is present', () => {
    const quiet = nextNoSignal(INITIAL_NO_SIGNAL, 0, true, 1000);
    const signal = nextNoSignal(quiet, SILENCE_PEAK_THRESHOLD, true, 2000);
    expect(signal.active).toBe(false);
    expect(signal.quietSinceMs).toBe(null);
  });

  it('does not fire before NO_SIGNAL_MS of continuous silence', () => {
    let state = INITIAL_NO_SIGNAL;
    state = nextNoSignal(state, 0, true, 1000);
    state = nextNoSignal(state, 0, true, 1000 + NO_SIGNAL_MS - 1);
    expect(state.active).toBe(false);
  });

  it('fires once NO_SIGNAL_MS of continuous silence has elapsed', () => {
    let state = INITIAL_NO_SIGNAL;
    state = nextNoSignal(state, 0, true, 1000);
    state = nextNoSignal(state, 0, true, 1000 + NO_SIGNAL_MS);
    expect(state.active).toBe(true);
  });

  it('a mid-stream signal sample resets the silence clock', () => {
    let state = INITIAL_NO_SIGNAL;
    state = nextNoSignal(state, 0, true, 1000);
    state = nextNoSignal(state, 1, true, 1000 + NO_SIGNAL_MS - 100);
    state = nextNoSignal(state, 0, true, 1000 + NO_SIGNAL_MS + 50);
    // Silence only restarted at (NO_SIGNAL_MS - 100), so not yet elapsed.
    expect(state.active).toBe(false);
  });

  it('stopping mid-silence clears the state', () => {
    let state = INITIAL_NO_SIGNAL;
    state = nextNoSignal(state, 0, true, 1000);
    state = nextNoSignal(state, 0, false, 2000);
    expect(state.active).toBe(false);
    expect(state.quietSinceMs).toBe(null);
  });
});
