import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, migratePatch, parsePatch, serializePatch } from './schema';
import type { VisualPatch } from './types';

function basePatch(overrides: Partial<VisualPatch> = {}): VisualPatch {
  return {
    schemaVersion: 1,
    seed: 'test-seed',
    operators: [
      {
        id: 'src1',
        generatorId: 'gen-source',
        generatorVersion: 1,
        parameters: { intensity: 0.5 },
      },
    ],
    routes: [],
    palette: {
      mode: 'mono',
      hueOffset: 120,
      saturation: 80,
      lightness: 50,
    },
    composition: {
      symmetry: 4,
      scale: 1,
      speed: 1,
    },
    qualityTier: 'medium',
    ...overrides,
  };
}

describe('synth/schema', () => {
  describe('CURRENT_SCHEMA_VERSION', () => {
    it('is 1', () => {
      expect(CURRENT_SCHEMA_VERSION).toBe(1);
    });
  });

  describe('serializePatch のキー順序独立性', () => {
    it('プロパティ挿入順が違っても同じ文字列になる', () => {
      const a: VisualPatch = {
        schemaVersion: 1,
        seed: 's',
        operators: [
          {
            id: 'op1',
            generatorId: 'g',
            generatorVersion: 1,
            parameters: { b: 2, a: 1 },
          },
        ],
        routes: [
          {
            source: 'time',
            target: 'op1.a',
            amount: 1,
            polarity: 'unipolar',
            smoothing: 0,
          },
        ],
        palette: {
          mode: 'rainbow',
          hueOffset: 10,
          saturation: 20,
          lightness: 30,
        },
        composition: { symmetry: 1, scale: 2, speed: 3 },
        qualityTier: 'high',
      };

      // Rebuild with different key insertion order
      const b = JSON.parse(
        JSON.stringify({
          qualityTier: a.qualityTier,
          composition: { speed: 3, scale: 2, symmetry: 1 },
          palette: {
            lightness: 30,
            saturation: 20,
            hueOffset: 10,
            mode: 'rainbow',
          },
          routes: [
            {
              smoothing: 0,
              polarity: 'unipolar',
              amount: 1,
              target: 'op1.a',
              source: 'time',
            },
          ],
          operators: [
            {
              parameters: { a: 1, b: 2 },
              generatorVersion: 1,
              generatorId: 'g',
              id: 'op1',
            },
          ],
          seed: 's',
          schemaVersion: 1,
        }),
      ) as VisualPatch;

      expect(serializePatch(a)).toBe(serializePatch(b));
    });

    it('ネストした parameters のキーもソートされる', () => {
      const p1 = basePatch({
        operators: [
          {
            id: 'src1',
            generatorId: 'g',
            generatorVersion: 1,
            parameters: { zeta: true, alpha: 1, mid: 'x' },
          },
        ],
      });
      const p2 = basePatch({
        operators: [
          {
            id: 'src1',
            generatorId: 'g',
            generatorVersion: 1,
            parameters: { alpha: 1, mid: 'x', zeta: true },
          },
        ],
      });
      expect(serializePatch(p1)).toBe(serializePatch(p2));
      expect(serializePatch(p1)).toContain('"alpha"');
      // alpha should appear before mid/zeta in the serialized string order of keys
      const s = serializePatch(p1);
      expect(s.indexOf('"alpha"')).toBeLessThan(s.indexOf('"mid"'));
      expect(s.indexOf('"mid"')).toBeLessThan(s.indexOf('"zeta"'));
    });
  });

  describe('parsePatch', () => {
    it('妥当な Patch を受理する', () => {
      const result = parsePatch(basePatch());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.patch.seed).toBe('test-seed');
        expect(result.patch.schemaVersion).toBe(1);
      }
    });

    it('不正な shape を拒否する', () => {
      const result = parsePatch({ schemaVersion: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.length).toBeGreaterThan(0);
      }
    });

    it('未知の schemaVersion（> CURRENT）を拒否する', () => {
      const result = parsePatch(basePatch({ schemaVersion: 99 }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((m) => m.includes('99') || m.includes('schemaVersion'))).toBe(
          true,
        );
      }
    });

    it('型不一致を拒否する', () => {
      const bad = {
        ...basePatch(),
        seed: 123,
      };
      const result = parsePatch(bad);
      expect(result.ok).toBe(false);
    });

    it('palette 範囲外を拒否する', () => {
      const result = parsePatch(
        basePatch({
          palette: {
            mode: 'mono',
            hueOffset: 400,
            saturation: 80,
            lightness: 50,
          },
        }),
      );
      expect(result.ok).toBe(false);
    });

    it('qualityTier の不正値を拒否する', () => {
      const result = parsePatch({
        ...basePatch(),
        qualityTier: 'ultra',
      });
      expect(result.ok).toBe(false);
    });

    it('null / 非オブジェクトを拒否する', () => {
      expect(parsePatch(null).ok).toBe(false);
      expect(parsePatch('patch').ok).toBe(false);
      expect(parsePatch(42).ok).toBe(false);
    });
  });

  describe('migratePatch', () => {
    it('schemaVersion === CURRENT はそのまま返す', () => {
      const input = basePatch();
      const out = migratePatch(input) as VisualPatch;
      expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(out.seed).toBe(input.seed);
    });

    it('schemaVersion > CURRENT は throw', () => {
      expect(() => migratePatch(basePatch({ schemaVersion: 2 }))).toThrow(/schemaVersion/);
    });

    it('schemaVersion が不正なら throw', () => {
      expect(() => migratePatch({ seed: 'x' })).toThrow();
      expect(() => migratePatch({ schemaVersion: 0.5 })).toThrow();
      expect(() => migratePatch({ schemaVersion: 0 })).toThrow();
    });

    it('happy path: migrate 後に parse できる', () => {
      const migrated = migratePatch(basePatch());
      const parsed = parsePatch(migrated);
      expect(parsed.ok).toBe(true);
    });
  });
});
