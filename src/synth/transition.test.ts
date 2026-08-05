import { describe, expect, it } from 'vitest';
import { createTransition, sameTopology, type TransitionSample } from './transition';
import type { ModulationRoute, TransitionSpec, VisualPatch } from './types';
import { DEFAULT_TRANSITION } from './types';

function op(
  id: string,
  generatorId: string,
  parameters: Record<string, number | string | boolean> = {},
  generatorVersion = 1,
) {
  return { id, generatorId, generatorVersion, parameters };
}

function route(
  partial: Partial<ModulationRoute> & Pick<ModulationRoute, 'source' | 'target'>,
): ModulationRoute {
  return {
    amount: 0.5,
    polarity: 'unipolar',
    smoothing: 0.1,
    ...partial,
  };
}

function basePatch(overrides: Partial<VisualPatch> = {}): VisualPatch {
  return {
    schemaVersion: 1,
    seed: 'from-seed',
    operators: [
      op('src', 'grid', { cells: 4, thickness: 0.1 }),
      op('mat', 'neon', { hue: 100, intensity: 1 }),
    ],
    routes: [route({ source: 'audio:bass', target: 'mat.intensity', amount: 0.4 })],
    palette: { mode: 'mono', hueOffset: 0, saturation: 50, lightness: 50 },
    composition: { symmetry: 2, scale: 1, speed: 1 },
    qualityTier: 'medium',
    ...overrides,
  };
}

function linearSpec(overrides: Partial<TransitionSpec> = {}): TransitionSpec {
  return {
    ...DEFAULT_TRANSITION,
    easing: 'linear',
    paletteMs: 1000,
    parameterMs: 1000,
    modulationMs: 1000,
    topologyMs: 1000,
    ...overrides,
  };
}

describe('synth/transition', () => {
  describe('sameTopology', () => {
    it('matches identical operator sequences', () => {
      const a = basePatch();
      const b = basePatch({
        seed: 'other',
        palette: { mode: 'rainbow', hueOffset: 90, saturation: 80, lightness: 40 },
      });
      expect(sameTopology(a, b)).toBe(true);
    });

    it('differs when generatorId differs', () => {
      const a = basePatch();
      const b = basePatch({
        operators: [op('src', 'points', { cells: 4 }), op('mat', 'neon', { hue: 100 })],
      });
      expect(sameTopology(a, b)).toBe(false);
    });

    it('differs when order differs', () => {
      const a = basePatch();
      const b = basePatch({
        operators: [op('mat', 'neon', { hue: 100 }), op('src', 'grid', { cells: 4 })],
      });
      expect(sameTopology(a, b)).toBe(false);
    });

    it('differs when count differs', () => {
      const a = basePatch();
      const b = basePatch({
        operators: [
          op('src', 'grid', { cells: 4 }),
          op('fld', 'noise', { scale: 1 }),
          op('mat', 'neon', { hue: 100 }),
        ],
      });
      expect(sameTopology(a, b)).toBe(false);
    });
  });

  describe('hue shortest arc', () => {
    it('350→10 goes via 0 (not 180)', () => {
      const from = basePatch({
        palette: { mode: 'mono', hueOffset: 350, saturation: 50, lightness: 50 },
      });
      const to = basePatch({
        seed: 'to',
        palette: { mode: 'mono', hueOffset: 10, saturation: 50, lightness: 50 },
      });
      const tr = createTransition(from, to, linearSpec({ paletteMs: 1000 }), 0);
      const mid = tr.sample(500).patch.palette.hueOffset;
      // shortest arc: +20° → mid ≈ 0
      expect(mid).toBeCloseTo(0, 5);
      expect(mid).toBeLessThan(20);
      expect(mid).toBeGreaterThanOrEqual(0);
    });

    it('10→350 goes via 0', () => {
      const from = basePatch({
        palette: { mode: 'mono', hueOffset: 10, saturation: 50, lightness: 50 },
      });
      const to = basePatch({
        seed: 'to',
        palette: { mode: 'mono', hueOffset: 350, saturation: 50, lightness: 50 },
      });
      const tr = createTransition(from, to, linearSpec({ paletteMs: 1000 }), 0);
      const mid = tr.sample(500).patch.palette.hueOffset;
      // shortest arc: -20° → mid ≈ 0
      expect(mid).toBeCloseTo(0, 5);
    });

    it('180° difference is consistent (clockwise from a to a+180)', () => {
      const from = basePatch({
        palette: { mode: 'mono', hueOffset: 0, saturation: 50, lightness: 50 },
      });
      const to = basePatch({
        seed: 'to',
        palette: { mode: 'mono', hueOffset: 180, saturation: 50, lightness: 50 },
      });
      const tr = createTransition(from, to, linearSpec({ paletteMs: 1000 }), 0);
      const mid = tr.sample(500).patch.palette.hueOffset;
      // ((180-0+540)%360)-180 = 180-180 = 0? Wait:
      // ((b-a+540)%360)-180 for a=0,b=180: (720%360)-180 = 0-180 = -180
      // so mid = 0 + (-180)*0.5 = -90 → normalized to 270
      // OR with classic while: d=180 stays 180, mid=90
      // Our formula: ((180-0+540)%360)-180 = (720%360)-180 = 0-180 = -180
      // So mid = ((0 + (-180)*0.5)%360+360)%360 = 270
      // Pick one direction and stick: expect 270 or 90 consistently
      expect([90, 270]).toContain(Math.round(mid));
      // and endpoints still correct
      expect(tr.sample(0).patch.palette.hueOffset).toBeCloseTo(0, 5);
      expect(tr.sample(1000).patch.palette.hueOffset).toBeCloseTo(180, 5);
    });
  });

  describe('layered timing', () => {
    it('palette reaches target before parameters when paletteMs < parameterMs', () => {
      const from = basePatch({
        palette: { mode: 'mono', hueOffset: 0, saturation: 0, lightness: 0 },
        operators: [
          op('src', 'grid', { cells: 0, thickness: 0.1 }),
          op('mat', 'neon', { hue: 0, intensity: 0.2 }),
        ],
        composition: { symmetry: 0, scale: 0.5, speed: 0.5 },
      });
      const to = basePatch({
        seed: 'to',
        palette: { mode: 'mono', hueOffset: 100, saturation: 100, lightness: 100 },
        operators: [
          op('src', 'grid', { cells: 10, thickness: 0.9 }),
          op('mat', 'neon', { hue: 200, intensity: 1.2 }),
        ],
        composition: { symmetry: 8, scale: 1.5, speed: 2.5 },
      });
      const tr = createTransition(
        from,
        to,
        linearSpec({ paletteMs: 500, parameterMs: 1000, modulationMs: 1000 }),
        0,
      );

      const atPaletteDone = tr.sample(500);
      expect(atPaletteDone.patch.palette.hueOffset).toBeCloseTo(100, 5);
      expect(atPaletteDone.patch.palette.saturation).toBeCloseTo(100, 5);
      // parameters only halfway (non-integer endpoints → plain lerp)
      expect(atPaletteDone.patch.operators[0]!.parameters.thickness as number).toBeCloseTo(0.5, 5);
      expect(atPaletteDone.patch.composition.scale).toBeCloseTo(1, 5);
      expect(atPaletteDone.done).toBe(false);

      const atParamDone = tr.sample(1000);
      expect(atParamDone.patch.operators[0]!.parameters.thickness as number).toBeCloseTo(0.9, 5);
      expect(atParamDone.done).toBe(true);
    });
  });

  describe('easing', () => {
    it('preserves 0/1 endpoints for easeInOut', () => {
      const from = basePatch({
        palette: { mode: 'mono', hueOffset: 0, saturation: 0, lightness: 50 },
      });
      const to = basePatch({
        seed: 'to',
        palette: { mode: 'mono', hueOffset: 0, saturation: 100, lightness: 50 },
      });
      const tr = createTransition(
        from,
        to,
        { ...linearSpec({ paletteMs: 1000 }), easing: 'easeInOut' },
        0,
      );
      expect(tr.sample(0).patch.palette.saturation).toBeCloseTo(0, 5);
      expect(tr.sample(1000).patch.palette.saturation).toBeCloseTo(100, 5);
    });

    it('easeInOut is monotonic', () => {
      const from = basePatch({
        palette: { mode: 'mono', hueOffset: 0, saturation: 0, lightness: 50 },
      });
      const to = basePatch({
        seed: 'to',
        palette: { mode: 'mono', hueOffset: 0, saturation: 100, lightness: 50 },
      });
      const tr = createTransition(
        from,
        to,
        { ...linearSpec({ paletteMs: 1000 }), easing: 'easeInOut' },
        0,
      );
      let prev = -1;
      for (let t = 0; t <= 1000; t += 50) {
        const s = tr.sample(t).patch.palette.saturation;
        expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = s;
      }
    });
  });

  describe('param interpolation', () => {
    it('rounds integers when both sides are integers', () => {
      const from = basePatch({
        operators: [op('src', 'grid', { cells: 0 }), op('mat', 'neon', { hue: 0 })],
        composition: { symmetry: 1, scale: 1, speed: 1 },
      });
      const to = basePatch({
        seed: 'to',
        operators: [op('src', 'grid', { cells: 10 }), op('mat', 'neon', { hue: 0 })],
        composition: { symmetry: 5, scale: 1, speed: 1 },
      });
      const tr = createTransition(from, to, linearSpec({ parameterMs: 1000 }), 0);
      const mid = tr.sample(500);
      expect(Number.isInteger(mid.patch.operators[0]!.parameters.cells)).toBe(true);
      expect(mid.patch.operators[0]!.parameters.cells).toBe(5);
      expect(Number.isInteger(mid.patch.composition.symmetry)).toBe(true);
      expect(mid.patch.composition.symmetry).toBe(3);
    });

    it('switches enum/bool at t >= 0.5', () => {
      const from = basePatch({
        operators: [
          op('src', 'grid', { mode: 'a', enabled: false, amount: 0 }),
          op('mat', 'neon', { hue: 0 }),
        ],
        palette: { mode: 'mono', hueOffset: 0, saturation: 50, lightness: 50 },
      });
      const to = basePatch({
        seed: 'to',
        operators: [
          op('src', 'grid', { mode: 'b', enabled: true, amount: 1 }),
          op('mat', 'neon', { hue: 0 }),
        ],
        palette: { mode: 'rainbow', hueOffset: 0, saturation: 50, lightness: 50 },
      });
      const tr = createTransition(from, to, linearSpec({ parameterMs: 1000, paletteMs: 1000 }), 0);

      const before = tr.sample(499);
      expect(before.patch.operators[0]!.parameters.mode).toBe('a');
      expect(before.patch.operators[0]!.parameters.enabled).toBe(false);
      expect(before.patch.palette.mode).toBe('mono');

      const after = tr.sample(500);
      expect(after.patch.operators[0]!.parameters.mode).toBe('b');
      expect(after.patch.operators[0]!.parameters.enabled).toBe(true);
      expect(after.patch.palette.mode).toBe('rainbow');
    });
  });

  describe('route fade in/out', () => {
    it('lerps shared routes and fades exclusive routes', () => {
      const sharedKey = { source: 'audio:bass', target: 'mat.intensity' } as const;
      const fromOnly = route({ source: 'audio:mid', target: 'mat.hue', amount: 1 });
      const toOnly = route({ source: 'audio:treble', target: 'src.cells', amount: 0.8 });
      const from = basePatch({
        routes: [route({ ...sharedKey, amount: 0.2 }), fromOnly],
      });
      const to = basePatch({
        seed: 'to',
        routes: [route({ ...sharedKey, amount: 0.8, polarity: 'bipolar', smoothing: 0.5 }), toOnly],
      });
      const tr = createTransition(from, to, linearSpec({ modulationMs: 1000 }), 0);

      const mid = tr.sample(500);
      const routes = mid.patch.routes;
      const byKey = (s: string, t: string) => routes.find((r) => r.source === s && r.target === t);

      const shared = byKey('audio:bass', 'mat.intensity')!;
      expect(shared.amount).toBeCloseTo(0.5, 5);
      // polarity switches at t>=0.5
      expect(shared.polarity).toBe('bipolar');

      const fadingOut = byKey('audio:mid', 'mat.hue')!;
      expect(fadingOut.amount).toBeCloseTo(0.5, 5);

      const fadingIn = byKey('audio:treble', 'src.cells')!;
      expect(fadingIn.amount).toBeCloseTo(0.4, 5);

      const done = tr.sample(1000);
      expect(done.patch.routes.find((r) => r.source === 'audio:mid')).toBeUndefined();
      expect(done.patch.routes.find((r) => r.source === 'audio:treble')!.amount).toBeCloseTo(
        0.8,
        5,
      );
      expect(done.patch.routes).toHaveLength(2);
    });
  });

  describe('done timing', () => {
    it('done when elapsed >= max of palette/parameter/modulation ms', () => {
      const from = basePatch();
      const to = basePatch({
        seed: 'to',
        palette: { mode: 'mono', hueOffset: 90, saturation: 80, lightness: 40 },
      });
      const tr = createTransition(
        from,
        to,
        linearSpec({ paletteMs: 300, parameterMs: 800, modulationMs: 500 }),
        100,
      );
      expect(tr.sample(100).done).toBe(false);
      expect(tr.sample(899).done).toBe(false);
      expect(tr.sample(900).done).toBe(true);
    });

    it('done immediately when all ms are 0', () => {
      const from = basePatch();
      const to = basePatch({ seed: 'to' });
      const tr = createTransition(
        from,
        to,
        linearSpec({ paletteMs: 0, parameterMs: 0, modulationMs: 0 }),
        50,
      );
      expect(tr.sample(50).done).toBe(true);
    });
  });

  describe('determinism', () => {
    it('same (from,to,spec,times) → identical samples', () => {
      const from = basePatch({
        palette: { mode: 'analogous', hueOffset: 10, saturation: 20, lightness: 30 },
        operators: [
          op('src', 'grid', { cells: 2, thickness: 0.05, enabled: true }),
          op('mat', 'neon', { hue: 40, intensity: 0.5 }),
        ],
        routes: [
          route({ source: 'audio:bass', target: 'mat.intensity', amount: 0.3 }),
          route({ source: 'time', target: 'src.cells', amount: 0.1 }),
        ],
      });
      const to = basePatch({
        seed: 'dest',
        qualityTier: 'high',
        palette: { mode: 'triadic', hueOffset: 200, saturation: 90, lightness: 70 },
        operators: [
          op('src', 'grid', { cells: 12, thickness: 0.2, enabled: false }),
          op('mat', 'neon', { hue: 300, intensity: 1.5 }),
        ],
        composition: { symmetry: 6, scale: 1.5, speed: 2 },
        routes: [
          route({
            source: 'audio:bass',
            target: 'mat.intensity',
            amount: 0.9,
            polarity: 'bipolar',
          }),
          route({ source: 'audio:level', target: 'mat.hue', amount: 0.7 }),
        ],
      });
      const spec = linearSpec({
        paletteMs: 1200,
        parameterMs: 800,
        modulationMs: 1000,
        easing: 'easeInOut',
      });
      const times = [0, 100, 400, 800, 999, 1200, 2000];

      const a = createTransition(from, to, spec, 0);
      const b = createTransition(from, to, spec, 0);
      for (const t of times) {
        expect(a.sample(t)).toEqual(b.sample(t));
      }
    });
  });

  describe('needsDecks / topology crossfade', () => {
    it('needsDecks true on topology change; fadeA/fadeB trajectory valid', () => {
      const from = basePatch();
      const to = basePatch({
        seed: 'to',
        operators: [op('src', 'points', { density: 1 }), op('mat', 'ink', { hue: 50 })],
      });
      const tr = createTransition(from, to, linearSpec({ topologyMs: 1000 }), 0);
      expect(tr.needsDecks).toBe(true);

      const samples: TransitionSample[] = [0, 250, 500, 750, 1000].map((t) => tr.sample(t));
      expect(samples[0]!.fadeA).toBeCloseTo(1, 5);
      expect(samples[0]!.fadeB).toBeCloseTo(0, 5);
      expect(samples[4]!.fadeA).toBeCloseTo(0, 5);
      expect(samples[4]!.fadeB).toBeCloseTo(1, 5);
      expect(samples[4]!.done).toBe(true);

      for (let i = 0; i < samples.length; i++) {
        const s = samples[i]!;
        expect(s.needsDecks).toBe(true);
        expect(s.patch).toBe(to);
        expect(s.fadeA + s.fadeB).toBeCloseTo(1, 5);
        if (i > 0) {
          expect(s.fadeA).toBeLessThanOrEqual(samples[i - 1]!.fadeA + 1e-9);
          expect(s.fadeB).toBeGreaterThanOrEqual(samples[i - 1]!.fadeB - 1e-9);
        }
      }
    });

    it('same topology: needsDecks false, fadeA=1, fadeB=0', () => {
      const from = basePatch();
      const to = basePatch({
        seed: 'to',
        palette: { mode: 'mono', hueOffset: 90, saturation: 10, lightness: 90 },
      });
      const tr = createTransition(from, to, linearSpec(), 0);
      expect(tr.needsDecks).toBe(false);
      const s = tr.sample(500);
      expect(s.needsDecks).toBe(false);
      expect(s.fadeA).toBe(1);
      expect(s.fadeB).toBe(0);
    });

    it('uses to for seed/schemaVersion/qualityTier', () => {
      const from = basePatch({ seed: 'A', schemaVersion: 1, qualityTier: 'low' });
      const to = basePatch({ seed: 'B', schemaVersion: 1, qualityTier: 'high' });
      const tr = createTransition(from, to, linearSpec(), 0);
      const s = tr.sample(0);
      expect(s.patch.seed).toBe('B');
      expect(s.patch.qualityTier).toBe('high');
    });
  });

  describe('image references', () => {
    const oldRef = { 'src.image': { name: 'old.png', hash: 'aaa' } };
    const newRef = { 'src.image': { name: 'new.png', hash: 'bbb' } };

    it('takes the target assignment immediately (no blank frame mid-morph)', () => {
      const tr = createTransition(
        basePatch({ images: oldRef }),
        basePatch({ images: newRef }),
        linearSpec(),
        0,
      );
      // start, middle and end of the parameter morph
      for (const t of [0, 400, 800]) {
        expect(tr.sample(t).patch.images).toEqual(newRef);
      }
    });

    it('carries images through a morph that only changes parameters', () => {
      const from = basePatch({ images: oldRef });
      const to = basePatch({
        images: oldRef,
        palette: { mode: 'mono', hueOffset: 180, saturation: 50, lightness: 50 },
      });
      const tr = createTransition(from, to, linearSpec(), 0);
      expect(tr.sample(100).patch.images).toEqual(oldRef);
    });

    it('leaves the key absent when neither side has images', () => {
      const tr = createTransition(basePatch(), basePatch({ seed: 'B' }), linearSpec(), 0);
      expect('images' in tr.sample(0).patch).toBe(false);
    });

    it('an images-only change stays a same-topology morph (no deck crossfade)', () => {
      const from = basePatch({ images: oldRef });
      const to = basePatch({ images: newRef });
      expect(sameTopology(from, to)).toBe(true);
      expect(createTransition(from, to, linearSpec(), 0).needsDecks).toBe(false);
    });
  });
});
