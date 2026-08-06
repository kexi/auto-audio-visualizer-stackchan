#!/usr/bin/env node
/**
 * `pnpm measure:coverage` — measure every Generator's screen coverage on a real
 * GPU and rewrite `src/synth/coverage.generated.ts`.
 *
 * The measurement itself lives in TypeScript (`src/synth/gl/coverageMeasure.ts`)
 * so it is type-checked alongside the catalog it walks. This file is only the
 * runner: Vite's SSR module loader executes that TypeScript directly, which
 * keeps the repo free of an extra TS-runner dependency.
 *
 * Needs a headless Chromium. Inside `nix develop` CHROMIUM_BIN is set for you;
 * Playwright does not read it on its own, the harness passes it to launch().
 *
 * Deterministic: two consecutive runs must produce a byte-identical file.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');

const server = await createServer({
  configFile: false,
  root,
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const mod = await server.ssrLoadModule('/src/synth/gl/coverageMeasure.ts');
  const started = Date.now();

  const { source, summary, measurements } = await mod.runCoverageSweep((p) => {
    const n = String(p.index + 1).padStart(String(p.total).length, ' ');
    const meanAlpha = p.coverage.meanAlpha.p50.toFixed(4);
    const solid = p.coverage.solidFraction.p50.toFixed(4);
    console.log(
      `[measure:coverage] ${n}/${p.total} ${p.id.padEnd(24, ' ')} ` +
        `meanAlpha.p50=${meanAlpha} solidFraction.p50=${solid}`,
    );
  });

  const outPath = path.join(root, mod.COVERAGE_OUTPUT_PATH);
  await writeFile(outPath, source, 'utf8');

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log('');
  console.log(summary);
  console.log('');
  console.log(
    `[measure:coverage] wrote ${measurements.length} generators to ${mod.COVERAGE_OUTPUT_PATH} in ${seconds}s`,
  );
} catch (e) {
  console.error('[measure:coverage] failed:', e instanceof Error ? e.stack : e);
  process.exitCode = 1;
} finally {
  await server.close();
}
