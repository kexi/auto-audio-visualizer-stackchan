/**
 * Coverage drift detection.
 *
 * Re-measures a slice of the catalog on a real GPU and compares against the
 * numbers recorded in `../coverage.generated.ts`. A shader edit that changes
 * how much of the frame a Generator fills — the thing this overlay cares about,
 * since it composites over live video — shows up here instead of silently
 * invalidating the table.
 *
 * A full sweep is ~2 minutes of GPU time, so the normal run re-measures a
 * deterministic sample (stable as the catalog grows, see `sampledCoverageIds`).
 * VJ_GPU_FULL=1 re-measures every generator, same as the other GPU suites.
 *
 * Playwright + Chromium; skip with visible reason if browser unavailable.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { GENERATOR_COVERAGE } from '../coverage.generated';
import {
  allCoverageIds,
  COVERAGE_DRIFT_SAMPLE_SIZE,
  COVERAGE_DRIFT_TOLERANCE,
  measureGeneratorCoverage,
  sampledCoverageIds,
} from './coverageMeasure';
import { closeGpu, fullSweep, launchGpu } from './gpuHarness';

const ALL_IDS = allCoverageIds();
const TARGET_IDS = fullSweep ? ALL_IDS : sampledCoverageIds(ALL_IDS, COVERAGE_DRIFT_SAMPLE_SIZE);

const session = await launchGpu(
  '[coverage.gpu.test] browser unavailable — coverage drift tests will be skipped:',
);

describe('synth coverage drift', () => {
  // Needs no GPU: guards the sample itself, so a browserless machine still
  // fails loudly if the drift check quietly stops covering anything.
  it(`re-measures ${TARGET_IDS.length} generator(s) (full=${fullSweep})`, () => {
    expect(TARGET_IDS.length).toBeGreaterThan(0);
    expect(TARGET_IDS.length).toBe(
      fullSweep ? ALL_IDS.length : Math.min(COVERAGE_DRIFT_SAMPLE_SIZE, ALL_IDS.length),
    );
    for (const id of TARGET_IDS) {
      expect(GENERATOR_COVERAGE[id], `${id} is missing from the coverage table`).toBeDefined();
    }
  });

  const pg = session.page;
  if (!pg) {
    it.skip(`browser unavailable — coverage drift tests skipped${
      session.error instanceof Error ? `: ${session.error.message}` : ''
    }`, () => {});
    return;
  }

  afterAll(async () => {
    await closeGpu(session);
  });

  // A sampled run measures ~12 generators × 8 parameter sets × 4 times;
  // VJ_GPU_FULL=1 does the whole catalog. Keep the ceiling generous.
  const driftTimeoutMs = 600_000;

  it(
    `recorded coverage still matches the GPU (±${COVERAGE_DRIFT_TOLERANCE})`,
    async () => {
      console.log(
        `[coverage.gpu.test] re-measuring ${TARGET_IDS.length} generator(s) (mode=${
          fullSweep ? 'full' : 'sampled'
        })`,
      );

      const failures: string[] = [];

      for (const id of TARGET_IDS) {
        const recorded = GENERATOR_COVERAGE[id];
        if (!recorded) {
          failures.push(`${id}: no recorded coverage — run \`pnpm measure:coverage\``);
          continue;
        }
        const fresh = (await measureGeneratorCoverage(pg, id)).coverage;
        for (const metric of ['meanAlpha', 'solidFraction'] as const) {
          for (const q of ['p10', 'p50', 'p90'] as const) {
            const was = recorded[metric][q];
            const now = fresh[metric][q];
            const delta = Math.abs(now - was);
            if (delta > COVERAGE_DRIFT_TOLERANCE) {
              failures.push(
                `${id}.${metric}.${q}: recorded ${was}, measured ${now.toFixed(4)} ` +
                  `(Δ${delta.toFixed(4)} > ${COVERAGE_DRIFT_TOLERANCE})`,
              );
            }
          }
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length} coverage value(s) drifted beyond ±${COVERAGE_DRIFT_TOLERANCE}.\n` +
            'If the shader change was intentional, run `pnpm measure:coverage` and commit the ' +
            'regenerated src/synth/coverage.generated.ts.\n\n' +
            failures.join('\n'),
        );
      }

      console.log(
        `[coverage.gpu.test] all ${TARGET_IDS.length} generator(s) match the recorded coverage`,
      );
    },
    driftTimeoutMs,
  );
});
