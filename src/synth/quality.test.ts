import { describe, expect, it } from 'vitest';
import { createQualityController } from './quality';
import type { QualityController } from './quality';

/**
 * frameMs 一定・stepMs 一定で controller を steps 回進める。
 * 戻り値は各呼び出しの (nowMs, scale)。
 */
function drive(
  controller: QualityController,
  frameMs: number,
  stepMs: number,
  steps: number,
  startNowMs = 0,
): { nowMs: number; scale: number }[] {
  const log: { nowMs: number; scale: number }[] = [];
  let nowMs = startNowMs;
  for (let i = 0; i < steps; i++) {
    nowMs += stepMs;
    const scale = controller.update(frameMs, nowMs);
    log.push({ nowMs, scale });
  }
  return log;
}

/** 連続する重複を除いた scale の訪問順（[1, 1, 0.75, 0.75, 0.5] → [1, 0.75, 0.5]）。 */
function visitedScales(log: { scale: number }[]): number[] {
  const out: number[] = [];
  for (const { scale } of log) {
    if (out[out.length - 1] !== scale) out.push(scale);
  }
  return out;
}

describe('createQualityController', () => {
  it('degrades step by step under sustained high load (never skips a level)', () => {
    // frameMs=40 は既定 degradeAboveMs=22 を超え続ける負荷。
    const controller = createQualityController();
    const log = drive(controller, 40, 40, 400); // 0..16000ms

    expect(visitedScales(log)).toEqual([1.0, 0.75, 0.5]);
    // 段階を経ずに 1.0 → 0.5 へ直接飛んだ記録がないこと。
    expect(log.some((e) => e.scale === 0.5)).toBe(true);
    expect(controller.scale).toBe(0.5);
  });

  it('recovers step by step under sustained low load (never skips a level)', () => {
    const controller = createQualityController();
    // まず高負荷で最低品質まで落とす。
    drive(controller, 40, 40, 400);
    expect(controller.scale).toBe(0.5);

    // 続けて低負荷（既定 recoverBelowMs=13 を下回り続ける）を与える。
    const recoverLog = drive(controller, 8, 8, 5000, 16000); // 40000ms 分の低負荷

    expect(visitedScales(recoverLog)).toEqual([0.5, 0.75, 1.0]);
    expect(controller.scale).toBe(1.0);
  });

  it('does not move within the hysteresis dead zone', () => {
    const controller = createQualityController();
    // 一段だけ落としておく（0.75 の状態から中立負荷を確認するため）。
    // 手計算: 1段目の遷移は now=2040、2段目(0.5)は cooldown 明けの now=6040。
    // その手前・0.75 のまま cooldown 中の now=3000 で中立負荷に切り替える。
    const downLog = drive(controller, 40, 40, 75); // 75 * 40ms = 3000ms
    const switchNow = downLog[downLog.length - 1]!.nowMs;
    expect(switchNow).toBe(3000);
    expect(controller.scale).toBe(0.75);

    // 既定 recoverBelowMs=13 と degradeAboveMs=22 の間、17ms は中立。
    const neutralLog = drive(controller, 17, 17, 2000, switchNow); // 34000ms 分

    expect(visitedScales(neutralLog)).toEqual([0.75]);
    expect(controller.scale).toBe(0.75);
  });

  it('does not change while in cooldown, even if the sustain condition is met', () => {
    const controller = createQualityController();
    const log = drive(controller, 40, 40, 400); // 0..16000ms、既定 sustain=2000 / cooldown=4000

    // 手計算: smoothedMs は初回で 40 に固定されるため、
    // degradeSinceMs は now=40 で立ち、sustain(2000ms) を満たす now=2040 で 1段目の遷移。
    const firstChange = log.find((e) => e.scale === 0.75);
    expect(firstChange?.nowMs).toBe(2040);

    // cooldown(4000ms) が明けるのは now = 2040 + 4000 = 6040。
    // その手前 now=6000 では、sustain 条件はとうに満たしていても cooldown 中なので変化しない。
    const beforeCooldownEnds = log.find((e) => e.nowMs === 6000);
    expect(beforeCooldownEnds?.scale).toBe(0.75);

    // cooldown が明けた now=6040 で 2段目の遷移。
    const secondChange = log.find((e) => e.scale === 0.5);
    expect(secondChange?.nowMs).toBe(6040);
  });

  it('ignores a single-frame spike (EWMA smoothing + sustain both protect against it)', () => {
    const controller = createQualityController();

    // 中立域(17ms)で十分ならしておく。
    drive(controller, 17, 17, 200); // 0..3400ms
    expect(controller.scale).toBe(1.0);

    // 1フレームだけ大きなスパイク。EWMA は緩やかにしか動かないため、
    // これだけでは sustain(2000ms) を満たせない。
    const spikeLog: number[] = [];
    let nowMs = 3400;
    nowMs += 17;
    spikeLog.push(controller.update(120, nowMs)); // spike frame

    // 以降は通常のフレーム時間に戻り、しばらく観察する。
    for (let i = 0; i < 300; i++) {
      nowMs += 17;
      spikeLog.push(controller.update(17, nowMs));
    }

    expect(spikeLog.every((s) => s === 1.0)).toBe(true);
    expect(controller.scale).toBe(1.0);
  });

  it('reset() restores the first scale and clears internal state (matches a fresh controller)', () => {
    const dirty = createQualityController();
    drive(dirty, 40, 40, 400); // push it down to 0.5 and dirty all internal timers
    expect(dirty.scale).toBe(0.5);

    dirty.reset();
    expect(dirty.scale).toBe(1.0);

    // 状態が完全にクリアされているなら、リセット後の挙動は新規インスタンスと一致するはず。
    const fresh = createQualityController();
    const dirtyLog = drive(dirty, 40, 40, 400);
    const freshLog = drive(fresh, 40, 40, 400);

    expect(dirtyLog.map((e) => e.scale)).toEqual(freshLog.map((e) => e.scale));
  });

  it('is deterministic: the same (frameMs, nowMs) series produces the same scale series', () => {
    // frameMs の混在パターン（負荷 → 中立 → 低負荷 → 単発スパイク）で再現性を確認する。
    const frameMsSeries = [
      ...Array.from({ length: 60 }, () => 40),
      ...Array.from({ length: 60 }, () => 17),
      ...Array.from({ length: 60 }, () => 8),
      120,
      ...Array.from({ length: 60 }, () => 17),
    ];

    const run = () => {
      const controller = createQualityController();
      const out: number[] = [];
      let nowMs = 0;
      for (const frameMs of frameMsSeries) {
        nowMs += frameMs;
        out.push(controller.update(frameMs, nowMs));
      }
      return out;
    };

    const a = run();
    const b = run();
    expect(a).toEqual(b);
    // 非自明であること（実際に段階が動いている）も確認しておく。
    expect(new Set(a).size).toBeGreaterThan(1);
  });
});
