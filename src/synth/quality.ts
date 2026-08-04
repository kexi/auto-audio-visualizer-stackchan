/**
 * Issue #6 の縮退ラダー第1段（内部解像度）。
 * Phase 2 時点では解像度スケールのみを扱う。
 *
 * フレーム時間 (frameMs) を EWMA で平滑化してから閾値判定する。
 * ヒステリシス（degrade / recover で別々の閾値）+ sustain（条件が
 * 連続して成立した時間）+ cooldown（変更直後の静定期間）を組み合わせ、
 * 単発のスパイクや閾値付近の揺らぎで頻繁に上げ下げ（発振）しないように
 * している。実際の描画・DOM・canvas 操作は行わない、状態遷移だけの
 * 純ロジック。
 *
 * `Date.now()` は呼ばない。時刻はすべて呼び出し側が渡す `nowMs` を使うため、
 * 決定的でテストしやすい。
 */

export interface QualityControllerOptions {
  /** 縮退の段階。高品質順。既定 [1.0, 0.75, 0.5] */
  scales?: number[];
  /** EWMA フレーム時間(ms)がこれを超え続けたら1段下げる。既定 22 */
  degradeAboveMs?: number;
  /** EWMA フレーム時間(ms)がこれを下回り続けたら1段上げる。既定 13 */
  recoverBelowMs?: number;
  /** 判定に必要な持続時間(ms)。既定 2000 */
  sustainMs?: number;
  /** 変更後のクールダウン(ms)。既定 4000 */
  cooldownMs?: number;
}

export interface QualityController {
  /** 毎フレーム呼ぶ。現在の解像度スケールを返す。 */
  update(frameMs: number, nowMs: number): number;
  readonly scale: number;
  reset(): void;
}

const DEFAULT_SCALES = [1.0, 0.75, 0.5];
const DEFAULT_DEGRADE_ABOVE_MS = 22;
const DEFAULT_RECOVER_BELOW_MS = 13;
const DEFAULT_SUSTAIN_MS = 2000;
const DEFAULT_COOLDOWN_MS = 4000;

/** EWMA の時定数(ms)。frameMs 自体を実質的な経過時間として使う逐次平滑。 */
const EWMA_TAU_MS = 500;

export function createQualityController(opts: QualityControllerOptions = {}): QualityController {
  const scales = opts.scales ?? DEFAULT_SCALES;
  if (scales.length === 0) {
    throw new Error('createQualityController: scales must not be empty');
  }
  const degradeAboveMs = opts.degradeAboveMs ?? DEFAULT_DEGRADE_ABOVE_MS;
  const recoverBelowMs = opts.recoverBelowMs ?? DEFAULT_RECOVER_BELOW_MS;
  const sustainMs = opts.sustainMs ?? DEFAULT_SUSTAIN_MS;
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;

  /** scales 内の現在位置。0 = 最高品質（先頭）。 */
  let index = 0;
  /** EWMA 平滑化済みフレーム時間(ms)。まだ1フレームも来ていなければ null。 */
  let smoothedMs: number | null = null;
  /** degradeAboveMs を連続して超えている区間の開始時刻。超えていなければ null。 */
  let degradeSinceMs: number | null = null;
  /** recoverBelowMs を連続して下回っている区間の開始時刻。下回っていなければ null。 */
  let recoverSinceMs: number | null = null;
  /** 直近に段階を変更した時刻。まだ一度も変更していなければ null。 */
  let lastChangeMs: number | null = null;

  function currentScale(): number {
    return scales[index]!;
  }

  return {
    update(frameMs: number, nowMs: number): number {
      // EWMA: k = 1 - exp(-frameMs/500)。初回は平滑化せずそのまま採用する。
      if (smoothedMs === null) {
        smoothedMs = frameMs;
      } else {
        const k = 1 - Math.exp(-frameMs / EWMA_TAU_MS);
        smoothedMs = smoothedMs + k * (frameMs - smoothedMs);
      }

      // ヒステリシス: 「超過」と「未満」を別閾値・別タイマーで独立に追跡する。
      // 閾値の間（デッドゾーン）ではどちらのタイマーも走らない。
      degradeSinceMs = smoothedMs > degradeAboveMs ? (degradeSinceMs ?? nowMs) : null;
      recoverSinceMs = smoothedMs < recoverBelowMs ? (recoverSinceMs ?? nowMs) : null;

      const cooling = lastChangeMs !== null && nowMs - lastChangeMs < cooldownMs;

      if (!cooling) {
        if (
          degradeSinceMs !== null &&
          nowMs - degradeSinceMs >= sustainMs &&
          index < scales.length - 1
        ) {
          index += 1;
          lastChangeMs = nowMs;
          degradeSinceMs = null;
          recoverSinceMs = null;
        } else if (recoverSinceMs !== null && nowMs - recoverSinceMs >= sustainMs && index > 0) {
          index -= 1;
          lastChangeMs = nowMs;
          degradeSinceMs = null;
          recoverSinceMs = null;
        }
      }

      return currentScale();
    },

    get scale(): number {
      return currentScale();
    },

    reset(): void {
      index = 0;
      smoothedMs = null;
      degradeSinceMs = null;
      recoverSinceMs = null;
      lastChangeMs = null;
    },
  };
}
