import { describe, expect, it } from 'vitest';
import { createCatalog } from './catalog';
import { DEFAULT_BUDGETS, estimateCost, fitsBudget } from './cost';
import { derivePatch } from './derive';
import { createInlineCatalog, inlineCatalog } from './generators';
import type { InlineGenerator } from './generators/types';
import { serializePatch } from './schema';
import type { VisualOperator, VisualPatch } from './types';
import { validatePatch } from './validate';

const SOURCE_IDS = [
  'grid',
  'points',
  'branch',
  'cells',
  'tiles',
  'wires',
  'concentric',
  'grille',
  'stripes',
] as const;

/** Sources used by derive buildRoutes (validate ∩ modulation). */
const ROUTE_AUDIO_SOURCES = new Set([
  'audio:bass',
  'audio:mid',
  'audio:treble',
  'audio:level',
  'audio:beatPhase',
  'audio:barPhase',
]);

function defCatalogFrom(catalog = inlineCatalog) {
  return createCatalog(catalog.all().map((g) => g.def));
}

function primarySourceId(patch: VisualPatch): string | undefined {
  const sources = patch.operators.filter((op) => op.id.startsWith('src'));
  const first = sources[0] ?? patch.operators.find((op) => op.id === 'src0');
  return first?.generatorId;
}

function sourceOps(patch: VisualPatch): VisualOperator[] {
  return patch.operators.filter((op) => op.id.startsWith('src'));
}

describe('synth/derive', () => {
  describe('public API / defaults', () => {
    it('derivePatch works with default qualityTier (medium)', () => {
      const patch = derivePatch('default-tier-seed', { catalog: inlineCatalog });
      expect(patch.qualityTier).toBe('medium');
      expect(patch.schemaVersion).toBe(1);
      expect(patch.seed).toBe('default-tier-seed');
      expect(patch.routes.length).toBeGreaterThanOrEqual(1);
      expect(patch.routes.length).toBeLessThanOrEqual(3);
    });
  });

  describe('determinism', () => {
    it('same seed → same serializePatch string twice', () => {
      const seed = 'neon-tiger-042';
      const a = serializePatch(derivePatch(seed, { catalog: inlineCatalog }));
      const b = serializePatch(derivePatch(seed, { catalog: inlineCatalog }));
      expect(a).toBe(b);
    });
  });

  describe('modulation routes', () => {
    it('routes length is 0–3 and usually ≥1 with full catalog', () => {
      let withRoutes = 0;
      for (let i = 0; i < 200; i++) {
        const patch = derivePatch(`routes-len-${i}`, { catalog: inlineCatalog });
        expect(patch.routes.length).toBeGreaterThanOrEqual(0);
        expect(patch.routes.length).toBeLessThanOrEqual(3);
        if (patch.routes.length >= 1) withRoutes += 1;
      }
      expect(withRoutes).toBeGreaterThan(180);
    });

    it('all routes use allowed audio sources, unique targets, finite amount, smoothing in [0.4, 1.6]', () => {
      for (let i = 0; i < 100; i++) {
        const patch = derivePatch(`routes-shape-${i}`, { catalog: inlineCatalog });
        const targets = new Set<string>();
        for (const route of patch.routes) {
          expect(ROUTE_AUDIO_SOURCES.has(route.source), `source ${route.source}`).toBe(true);
          expect(targets.has(route.target), `duplicate target ${route.target}`).toBe(false);
          targets.add(route.target);
          expect(Number.isFinite(route.amount)).toBe(true);
          expect(route.amount).not.toBe(0);
          expect(route.smoothing).toBeGreaterThanOrEqual(0.4);
          expect(route.smoothing).toBeLessThanOrEqual(1.6);
          expect(route.polarity === 'unipolar' || route.polarity === 'bipolar').toBe(true);
        }
      }
    });

    it('same seed yields identical routes', () => {
      const seed = 'route-det-seed';
      const a = derivePatch(seed, { catalog: inlineCatalog }).routes;
      const b = derivePatch(seed, { catalog: inlineCatalog }).routes;
      expect(a).toEqual(b);
    });
  });

  describe('diversity', () => {
    it('different seeds → different patches (100 seeds)', () => {
      const serials = new Set<string>();
      const sourceIds = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const patch = derivePatch(`diversity-${i}`, { catalog: inlineCatalog });
        serials.add(serializePatch(patch));
        for (const op of sourceOps(patch)) {
          sourceIds.add(op.generatorId);
        }
      }
      expect(serials.size).toBeGreaterThan(1);
      expect(sourceIds.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('always valid & in budget', () => {
    it('~200 seeds: validatePatch returns [] and fitsBudget returns []', () => {
      const catalog = defCatalogFrom();
      for (let i = 0; i < 200; i++) {
        const seed = `valid-budget-${i}`;
        const patch = derivePatch(seed, { catalog: inlineCatalog });
        const vIssues = validatePatch(patch, catalog);
        const bIssues = fitsBudget(
          estimateCost(patch, catalog),
          DEFAULT_BUDGETS[patch.qualityTier],
        );
        expect(vIssues, `validate failed for ${seed}: ${JSON.stringify(vIssues)}`).toEqual([]);
        expect(bIssues, `budget failed for ${seed}: ${JSON.stringify(bIssues)}`).toEqual([]);
      }
    });
  });

  describe('source coverage', () => {
    it('all 9 sources (grid, points, branch, cells, tiles, wires, concentric, grille, stripes) appear across many seeds', () => {
      const seen = new Set<string>();
      const maxSeeds = 5000;
      for (let i = 0; i < maxSeeds && seen.size < SOURCE_IDS.length; i++) {
        const patch = derivePatch(`source-cover-${i}`, { catalog: inlineCatalog });
        for (const op of sourceOps(patch)) {
          seen.add(op.generatorId);
        }
      }
      for (const id of SOURCE_IDS) {
        expect(seen.has(id), `source "${id}" never selected in ${maxSeeds} seeds`).toBe(true);
      }
    });
  });

  describe('source distribution (report)', () => {
    it('logs counts per source id over 300 seeds', () => {
      const counts: Record<string, number> = {
        grid: 0,
        points: 0,
        branch: 0,
        cells: 0,
        tiles: 0,
        wires: 0,
        concentric: 0,
        grille: 0,
        stripes: 0,
      };
      for (let i = 0; i < 300; i++) {
        const patch = derivePatch(`dist-${i}`, { catalog: inlineCatalog });
        for (const op of sourceOps(patch)) {
          counts[op.generatorId] = (counts[op.generatorId] ?? 0) + 1;
        }
      }
      const report = Object.entries(counts)
        .map(([id, n]) => `${id}=${n}`)
        .join(', ');
      console.log(`[derive] source distribution over 300 seeds (operator occurrences): ${report}`);
      // Every real source should appear at least once in 300 seeds with high probability;
      // soft-check total mass and that keys are populated.
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThanOrEqual(300); // at least 1 source each
      expect(Object.keys(counts).length).toBeGreaterThanOrEqual(9);
    });
  });

  describe('rendezvous stability', () => {
    it('removing one source (cells): seeds that did not pick cells keep the same src0', () => {
      const full = inlineCatalog;
      const reduced = createInlineCatalog(full.all().filter((g) => g.def.id !== 'cells'));

      const n = 800;
      let compared = 0;
      let changedAmongNonCells = 0;
      let fullPickedCells = 0;
      let overallChanged = 0;

      for (let i = 0; i < n; i++) {
        const seed = `rendezvous-rm-cells-${i}`;
        const fullPatch = derivePatch(seed, { catalog: full });
        const reducedPatch = derivePatch(seed, { catalog: reduced });
        const fullSrc = primarySourceId(fullPatch);
        const reducedSrc = primarySourceId(reducedPatch);
        expect(fullSrc).toBeDefined();
        expect(reducedSrc).toBeDefined();

        if (fullSrc !== reducedSrc) overallChanged += 1;

        if (fullSrc === 'cells') {
          fullPickedCells += 1;
        } else {
          compared += 1;
          if (fullSrc !== reducedSrc) changedAmongNonCells += 1;
        }
      }

      const overallRate = overallChanged / n;
      const nonCellsChangeRate = compared > 0 ? changedAmongNonCells / compared : 0;
      const cellsPickRate = fullPickedCells / n;

      console.log(
        `[derive] rendezvous remove "cells" (n=${n}): ` +
          `overallChange=${(overallRate * 100).toFixed(2)}%, ` +
          `nonCellsSrc0Change=${(nonCellsChangeRate * 100).toFixed(2)}%, ` +
          `fullPickedCellsAsSrc0=${(cellsPickRate * 100).toFixed(2)}%`,
      );

      // Seeds that did not select the removed generator must stay put.
      expect(
        changedAmongNonCells,
        `expected 0 changes among non-cells winners, got ${changedAmongNonCells}/${compared}`,
      ).toBe(0);

      // Overall change should be well under naive reindex (~50%+); theoretically ~ fraction that picked cells.
      expect(overallRate).toBeLessThan(0.5);
      expect(overallRate).toBeGreaterThan(0); // some seeds did use cells
    });

    it('adding a fake extra source: change rate ≈ 1/(n+1) and low', () => {
      const fullSources = inlineCatalog.all().filter((g) => g.def.category === 'source');
      const nSources = fullSources.length; // 4
      const fake: InlineGenerator = {
        def: {
          id: 'fake-source-zz',
          version: 1,
          category: 'source',
          costClass: 'micro',
          impl: 'inline',
          output: 'field',
          tags: {},
          parameters: [
            {
              id: 'amount',
              label: 'Amount',
              kind: 'number',
              min: 0,
              max: 1,
              default: 0.5,
              modulatable: true,
            },
          ],
          cost: { passes: 0, relativeFill: 0.1, stateful: false },
        },
        emit: () => 'float fake(vec2 p){return 0.0;}',
      };

      const withExtra = createInlineCatalog([...inlineCatalog.all(), fake]);
      const sample = 1000;
      let changed = 0;
      let pickedFake = 0;

      for (let i = 0; i < sample; i++) {
        const seed = `rendezvous-add-fake-${i}`;
        const basePatch = derivePatch(seed, { catalog: inlineCatalog });
        const extraPatch = derivePatch(seed, { catalog: withExtra });
        const baseSrc = primarySourceId(basePatch)!;
        const extraSrc = primarySourceId(extraPatch)!;
        if (baseSrc !== extraSrc) changed += 1;
        if (extraSrc === fake.def.id) pickedFake += 1;
      }

      const changeRate = changed / sample;
      const fakeRate = pickedFake / sample;
      const expected = 1 / (nSources + 1);

      console.log(
        `[derive] rendezvous add fake source (n=${sample}, baseSources=${nSources}): ` +
          `src0Change=${(changeRate * 100).toFixed(2)}%, ` +
          `pickedFakeAsSrc0=${(fakeRate * 100).toFixed(2)}%, ` +
          `theory≈${(expected * 100).toFixed(2)}%`,
      );

      // Should be clearly better than reindex chaos; near 1/(n+1) ≈ 20%.
      expect(changeRate).toBeLessThan(0.45);
      expect(changeRate).toBeGreaterThan(0.05);
      // Fake win rate as primary should also be in a plausible band around 1/(n+1).
      expect(fakeRate).toBeGreaterThan(0.05);
      expect(fakeRate).toBeLessThan(0.45);
    });
  });

  describe('structure', () => {
    it('operators are ordered Source → Field → Modifier → Material with expected id prefixes', () => {
      const catalog = defCatalogFrom();
      for (let i = 0; i < 50; i++) {
        const patch = derivePatch(`structure-${i}`, { catalog: inlineCatalog, qualityTier: 'low' });
        const ranks = patch.operators.map((op) => {
          const def = catalog.get(op.generatorId);
          expect(def).toBeDefined();
          return { source: 0, field: 1, modifier: 2, material: 3 }[def!.category];
        });
        for (let j = 1; j < ranks.length; j++) {
          expect(ranks[j]!).toBeGreaterThanOrEqual(ranks[j - 1]!);
        }
        expect(patch.operators.some((op) => op.id.startsWith('src'))).toBe(true);
        expect(patch.operators.some((op) => op.id.startsWith('mod'))).toBe(true);
        expect(patch.operators.some((op) => op.id.startsWith('mat'))).toBe(true);
      }
    });
  });
});
