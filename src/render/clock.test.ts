import { describe, expect, it } from 'vitest';
import { FixedStepClock, realtimeClock } from './clock';

describe('realtimeClock', () => {
  it('now() is monotonically non-decreasing', () => {
    const a = realtimeClock.now();
    const b = realtimeClock.now();
    expect(b).toBeGreaterThanOrEqual(a);
    expect(typeof a).toBe('number');
  });
});

describe('FixedStepClock', () => {
  it('advances by 1000/fps ms per advance()', () => {
    const clock = new FixedStepClock(60);
    expect(clock.frame).toBe(0);
    expect(clock.now()).toBe(0);
    clock.advance();
    expect(clock.frame).toBe(1);
    expect(clock.now()).toBeCloseTo(1000 / 60, 10);
    clock.advance();
    expect(clock.frame).toBe(2);
    expect(clock.now()).toBeCloseTo(2 * (1000 / 60), 10);
  });

  it('reset() returns to frame 0', () => {
    const clock = new FixedStepClock(60);
    clock.advance();
    clock.advance();
    clock.reset();
    expect(clock.frame).toBe(0);
    expect(clock.now()).toBe(0);
  });

  it('is deterministic for a given frame', () => {
    const a = new FixedStepClock(30);
    const b = new FixedStepClock(30);
    for (let i = 0; i < 5; i++) {
      a.advance();
      b.advance();
    }
    expect(a.now()).toBe(b.now());
    expect(a.frame).toBe(5);
    // same frame always same time
    expect(a.now()).toBe(5 * (1000 / 30));
  });
});
