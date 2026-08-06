/**
 * Pure helpers behind the ControlPanel's input level meter: dBFS conversion,
 * peak-hold ballistics, the clip latch, and no-signal detection.
 *
 * Kept dependency-free and side-effect-free (time is always an explicit
 * argument) so they're trivially unit-testable without faking `Date.now()`.
 * ControlPanel owns the actual `setInterval` polling and local state; these
 * functions only compute the next value/state given the previous one.
 */

/** dB floor the meter clamps to instead of -Infinity at zero amplitude. */
export const DB_FLOOR = -60;
/** dB ceiling (0 dBFS = full scale). */
export const DB_CEIL = 0;

/** Scale marks shown along the meter track, in dBFS. */
export const SCALE_TICKS_DB: readonly number[] = [-60, -40, -20, -12, -6, 0];

/** "Safe" gain-staging zone, in dBFS — the band drawn on the track. */
export const SAFE_ZONE_DB: readonly [number, number] = [-18, -6];

/** Sample-peak threshold (0..1) at which the clip latch lights. */
export const CLIP_THRESHOLD = 0.99;
/** How long the clip latch stays lit after the last clip sample, ms. */
export const CLIP_HOLD_MS = 1500;

/** How long the peak-hold line stays pinned at its peak before decaying, ms. */
export const PEAK_HOLD_MS = 1200;
/** Peak-hold decay rate once the hold window elapses, amplitude units/sec. */
export const PEAK_DECAY_PER_SEC = 0.7;

/**
 * Pre-gain sample-peak threshold (0..1) below which the input reads
 * "silent" (~-60dBFS). `peak` comes from `AnalyserNode.getFloatTimeDomainData`
 * (see AudioEngine.getFrame), not the 8-bit byte buffer, so it isn't limited
 * to the byte buffer's ~-42dBFS quantization floor — a threshold this far
 * below 0dBFS is meaningful rather than being an unreachable no-op.
 */
export const SILENCE_PEAK_THRESHOLD = 0.001;
/** How long a running engine must stay below the silence threshold before NO SIGNAL fires, ms. */
export const NO_SIGNAL_MS = 3000;

/**
 * Convert a linear amplitude (0..1, e.g. an RMS or peak sample) to dBFS.
 * Zero (and any non-positive input) clamps to {@link DB_FLOOR} rather than
 * producing -Infinity.
 */
export function toDb(amplitude: number): number {
  if (!(amplitude > 0)) return DB_FLOOR;
  const db = 20 * Math.log10(amplitude);
  return db < DB_FLOOR ? DB_FLOOR : db;
}

/**
 * Map a dBFS value onto a 0..1 fraction of the {@link DB_FLOOR}..{@link DB_CEIL}
 * track, clamped at both ends. Suitable for a bar width/position.
 */
export function dbToFraction(db: number): number {
  const clamped = db < DB_FLOOR ? DB_FLOOR : db > DB_CEIL ? DB_CEIL : db;
  return (clamped - DB_FLOOR) / (DB_CEIL - DB_FLOOR);
}

/** Peak-hold indicator state (linear amplitude, 0..1). */
export interface PeakHoldState {
  /** Currently displayed held peak, 0..1. */
  readonly value: number;
  /** Wall-clock time `value` was last set to a new (rising) peak, ms. */
  readonly peakAtMs: number;
  /** Wall-clock time of this state snapshot, ms — used to derive decay dt. */
  readonly updatedAtMs: number;
}

export const INITIAL_PEAK_HOLD: PeakHoldState = { value: 0, peakAtMs: 0, updatedAtMs: 0 };

/**
 * Advance the peak-hold state by one sample.
 *
 * Rising peaks are tracked immediately. Once the signal falls below the held
 * value, the indicator stays pinned for {@link PEAK_HOLD_MS}, then falls at a
 * constant rate ({@link PEAK_DECAY_PER_SEC}/s) — but never below the current
 * sample peak, so it snaps back onto rising signal instead of overshooting.
 */
export function nextPeakHold(
  prev: PeakHoldState,
  currentPeak: number,
  nowMs: number,
): PeakHoldState {
  if (currentPeak >= prev.value) {
    return { value: currentPeak, peakAtMs: nowMs, updatedAtMs: nowMs };
  }
  const heldFor = nowMs - prev.peakAtMs;
  if (heldFor < PEAK_HOLD_MS) {
    return { value: prev.value, peakAtMs: prev.peakAtMs, updatedAtMs: nowMs };
  }
  // Decay only accrues from the moment the hold window actually expired, not
  // from `updatedAtMs` — otherwise a poll landing exactly on (or just past)
  // the hold boundary would count the whole held interval as decay time.
  const decayStartMs = prev.peakAtMs + PEAK_HOLD_MS;
  const decayFromMs = Math.max(prev.updatedAtMs, decayStartMs);
  const dtSec = Math.max(0, nowMs - decayFromMs) / 1000;
  const decayed = Math.max(currentPeak, prev.value - PEAK_DECAY_PER_SEC * dtSec);
  return { value: decayed, peakAtMs: prev.peakAtMs, updatedAtMs: nowMs };
}

/** Clip-indicator latch state. */
export interface ClipLatchState {
  /** Whether the clip indicator is currently lit. */
  readonly active: boolean;
  /** Wall-clock time of the most recent clip sample, ms. */
  readonly litAtMs: number;
}

export const INITIAL_CLIP_LATCH: ClipLatchState = { active: false, litAtMs: -Infinity };

/**
 * Advance the clip latch by one sample. Lights (and re-arms its hold timer)
 * whenever the sample peak reaches {@link CLIP_THRESHOLD}; otherwise stays lit
 * until {@link CLIP_HOLD_MS} have passed since the last clip sample.
 */
export function nextClipLatch(
  prev: ClipLatchState,
  currentPeak: number,
  nowMs: number,
): ClipLatchState {
  if (currentPeak >= CLIP_THRESHOLD) {
    return { active: true, litAtMs: nowMs };
  }
  if (prev.active && nowMs - prev.litAtMs < CLIP_HOLD_MS) {
    return prev;
  }
  return prev.active ? { active: false, litAtMs: prev.litAtMs } : prev;
}

/** NO SIGNAL detector state. */
export interface NoSignalState {
  /** Whether NO SIGNAL should currently be displayed. */
  readonly active: boolean;
  /** Wall-clock time the input first dropped below the silence threshold, ms (or null while signal is present). */
  readonly quietSinceMs: number | null;
}

export const INITIAL_NO_SIGNAL: NoSignalState = { active: false, quietSinceMs: null };

/**
 * Advance the no-signal detector by one sample.
 *
 * Only meaningful while `running` — a stopped/idle engine never shows NO
 * SIGNAL (that's just the expected idle state, not a field problem). While
 * running, the peak must stay below {@link SILENCE_PEAK_THRESHOLD}
 * continuously for {@link NO_SIGNAL_MS} before `active` flips true; any
 * sample at or above the threshold resets the timer immediately.
 */
export function nextNoSignal(
  prev: NoSignalState,
  peak: number,
  running: boolean,
  nowMs: number,
): NoSignalState {
  if (!running) return INITIAL_NO_SIGNAL;
  if (peak >= SILENCE_PEAK_THRESHOLD) return { active: false, quietSinceMs: null };
  const quietSinceMs = prev.quietSinceMs ?? nowMs;
  const active = nowMs - quietSinceMs >= NO_SIGNAL_MS;
  return { active, quietSinceMs };
}
