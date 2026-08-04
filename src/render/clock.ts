/** 描画ループの時間源。オフラインレンダリング時に差し替えられるよう抽象化する。 */
export interface Clock {
  /** 単調増加するミリ秒。 */
  now(): number;
}

/** 実時間クロック（既定）。performance.now() を使う。 */
export const realtimeClock: Clock = {
  now: () => performance.now(),
};

/**
 * 固定タイムステップのクロック。フレーム番号と fps から時刻を決める。
 * オフラインの決定的レンダリングで使う。
 */
export class FixedStepClock implements Clock {
  private readonly fps: number;
  private _frame = 0;

  constructor(fps: number) {
    this.fps = fps;
  }

  now(): number {
    return this._frame * (1000 / this.fps);
  }

  /** 1フレーム進める。 */
  advance(): void {
    this._frame += 1;
  }

  /** フレーム 0 に戻す。 */
  reset(): void {
    this._frame = 0;
  }

  get frame(): number {
    return this._frame;
  }
}
