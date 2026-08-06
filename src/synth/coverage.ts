/**
 * Generator coverage — how much of the frame a Generator actually fills.
 *
 * NOT `GeneratorDefinition.cost.relativeFill`. That field is a *performance*
 * estimate (fillrate load); coverage is a *visual* measurement taken on a real
 * GPU. This overlay is composited over live video in OBS with premultiplied
 * alpha, so a Generator that paints the whole frame hides whatever is beneath
 * it. Two numbers, because one is not enough:
 *
 * - `meanAlpha`     — mean alpha over every pixel. "how much is being drawn"
 * - `solidFraction` — fraction of pixels with alpha > 0.5. "how much of the
 *                     video underneath is blocked"
 *
 * A thin 50% veil over the whole frame and an opaque blob over half of it can
 * share a `meanAlpha` and mean the opposite thing as an overlay. What blocks
 * the video is the high-alpha *area*, not the average.
 *
 * The numbers themselves live in `coverage.generated.ts`, written by
 * `pnpm measure:coverage`. This module owns the types and the (pure)
 * statistics so both the measurement script and the tests agree on them.
 * It deliberately does NOT import the generated table: the measurement script
 * pulls in these helpers to *produce* that file, so depending on it here would
 * make the sweep unrunnable whenever the table is missing or stale.
 *
 * Nothing in the runtime reads this yet — deriving patches under a coverage
 * constraint is deliberately a later change.
 */

/** Alpha above this (0..1) counts as "blocking the video underneath". */
export const COVERAGE_SOLID_ALPHA = 0.5;

/** Decimal places kept in the generated file, so diffs stay readable. */
export const COVERAGE_DECIMALS = 4;

/** Spread of a metric across the sampled parameter sets. */
export interface CoverageDistribution {
  p10: number;
  p50: number;
  p90: number;
}

export interface GeneratorCoverage {
  meanAlpha: CoverageDistribution;
  solidFraction: CoverageDistribution;
}

export type CoverageTable = Record<string, GeneratorCoverage>;

/** Catalog ids with no measurement (i.e. added since the last sweep). */
export function missingCoverageIds(table: CoverageTable, catalogIds: readonly string[]): string[] {
  return catalogIds.filter((id) => !(id in table)).sort();
}

/** Measured ids no longer in the catalog (i.e. removed or renamed). */
export function staleCoverageIds(table: CoverageTable, catalogIds: readonly string[]): string[] {
  const known = new Set(catalogIds);
  return Object.keys(table)
    .filter((id) => !known.has(id))
    .sort();
}

/** Round to the precision stored in the generated file. */
export function roundCoverage(value: number): number {
  const scale = 10 ** COVERAGE_DECIMALS;
  return Math.round(value * scale) / scale;
}

/**
 * Linearly interpolated percentile (the "type 7" definition used by NumPy and
 * R's default). `q` is 0..1. Deterministic for a given input array.
 */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) throw new Error('percentile: empty sample');
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** p10 / p50 / p90 of a sample, rounded for storage. */
export function distributionOf(values: readonly number[]): CoverageDistribution {
  return {
    p10: roundCoverage(percentile(values, 0.1)),
    p50: roundCoverage(percentile(values, 0.5)),
    p90: roundCoverage(percentile(values, 0.9)),
  };
}

/** Mean of a non-empty sample. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('mean: empty sample');
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}
