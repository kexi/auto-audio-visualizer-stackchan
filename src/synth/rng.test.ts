import { describe, expect, it } from 'vitest';
import { createRngStream, rand } from './rng';

describe('synth/rng', () => {
  describe('決定性', () => {
    it('同じ (seed, namespace, index) で常に同じ値を返す', () => {
      const a = rand('neon-tiger-042', 'generator:grid', 7);
      const b = rand('neon-tiger-042', 'generator:grid', 7);
      const c = rand('neon-tiger-042', 'generator:grid', 7);
      expect(a).toBe(b);
      expect(b).toBe(c);
    });
  });

  describe('呼び出し順非依存', () => {
    it('at(5) は先に呼んでも後に呼んでも同じ', () => {
      const streamA = createRngStream('neon-tiger-042', 'generator:grid');
      const first = streamA.at(5);
      const later = streamA.at(0);
      void later;
      expect(streamA.at(5)).toBe(first);

      const streamB = createRngStream('neon-tiger-042', 'generator:grid');
      streamB.at(0);
      streamB.at(1);
      streamB.at(99);
      expect(streamB.at(5)).toBe(first);

      // rand() とも一致
      expect(rand('neon-tiger-042', 'generator:grid', 5)).toBe(first);
    });
  });

  describe('名前空間の独立性', () => {
    it('namespace が違えば別の列になる', () => {
      const a = createRngStream('shared-seed', 'generator:grid');
      const b = createRngStream('shared-seed', 'generator:particles');
      // いくつかの index で比較し、少なくとも一部は異なること
      const diffs = [0, 1, 2, 3, 4, 5, 10, 100].filter((i) => a.at(i) !== b.at(i));
      expect(diffs.length).toBeGreaterThan(0);
      // 先頭だけでも確実に違うこと（Generator 追加で既存列が変わらない担保）
      expect(a.at(0)).not.toBe(b.at(0));
    });
  });

  describe('範囲', () => {
    it('全ての戻り値が 0 以上 1 未満', () => {
      const stream = createRngStream('range-seed', 'range-ns');
      for (let i = 0; i < 1000; i++) {
        const v = stream.at(i);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
      for (let i = 0; i < 100; i++) {
        const v = rand(`seed-${i}`, `ns-${i % 7}`, i * 13);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('分布', () => {
    it('10000 サンプルの平均が 0.5 ± 0.02、min < 0.01、max > 0.99', () => {
      const stream = createRngStream('dist-seed', 'dist-ns');
      const n = 10000;
      let sum = 0;
      let min = 1;
      let max = 0;
      for (let i = 0; i < n; i++) {
        const v = stream.at(i);
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const mean = sum / n;
      expect(mean).toBeGreaterThan(0.48);
      expect(mean).toBeLessThan(0.52);
      expect(min).toBeLessThan(0.01);
      expect(max).toBeGreaterThan(0.99);
    });
  });

  describe('golden test', () => {
    /**
     * 既知入力に対する期待値（数値リテラル固定）。
     * アルゴリズムを不用意に変えたら必ず落ちる。
     */
    const golden: Array<{ seed: string; namespace: string; index: number; expected: number }> = [
      {
        seed: 'neon-tiger-042',
        namespace: 'generator:grid',
        index: 0,
        expected: 0.8705808520317078,
      },
      {
        seed: 'neon-tiger-042',
        namespace: 'generator:grid',
        index: 1,
        expected: 0.5291868448257446,
      },
      {
        seed: 'neon-tiger-042',
        namespace: 'generator:grid',
        index: 42,
        expected: 0.7726343274116516,
      },
      {
        seed: 'neon-tiger-042',
        namespace: 'generator:particles',
        index: 0,
        expected: 0.6852662563323975,
      },
      {
        seed: 'void-whisper-7',
        namespace: 'generator:grid',
        index: 0,
        expected: 0.964968204498291,
      },
      {
        seed: 'void-whisper-7',
        namespace: 'layer:bloom',
        index: 3,
        expected: 0.558577299118042,
      },
      { seed: 'alpha', namespace: 'beta', index: 0, expected: 0.008688390254974365 },
      { seed: 'alpha', namespace: 'beta', index: 100, expected: 0.37722891569137573 },
    ];

    it('既知入力がハードコード期待値と一致する', () => {
      for (const { seed, namespace, index, expected } of golden) {
        expect(rand(seed, namespace, index)).toBe(expected);
        expect(createRngStream(seed, namespace).at(index)).toBe(expected);
      }
    });
  });

  describe('24bit 制約', () => {
    it('戻り値 × 16777216 が常に整数である', () => {
      const stream = createRngStream('bits-seed', 'bits-ns');
      for (let i = 0; i < 2000; i++) {
        const v = stream.at(i);
        const scaled = v * 16777216;
        expect(Number.isInteger(scaled)).toBe(true);
      }
      expect(Number.isInteger(rand('neon-tiger-042', 'generator:grid', 0) * 16777216)).toBe(true);
    });
  });

  describe('next / reset', () => {
    it('同じ回数の next() で同じ列を返し、reset() で巻き戻る', () => {
      const a = createRngStream('seq-seed', 'seq-ns');
      const b = createRngStream('seq-seed', 'seq-ns');

      const seqA = [a.next(), a.next(), a.next(), a.next(), a.next()];
      const seqB = [b.next(), b.next(), b.next(), b.next(), b.next()];
      expect(seqA).toEqual(seqB);

      // at(i) と next の列が一致（カウンタ 0 起点）
      const stream = createRngStream('seq-seed', 'seq-ns');
      for (let i = 0; i < 5; i++) {
        expect(stream.next()).toBe(stream.at(i));
      }

      // ただし next はカウンタを進めるので、上のループ後 at との比較は別インスタンスで
      const s1 = createRngStream('seq-seed', 'seq-ns');
      const s2 = createRngStream('seq-seed', 'seq-ns');
      expect(s1.next()).toBe(s2.at(0));
      expect(s1.next()).toBe(s2.at(1));
      expect(s1.next()).toBe(s2.at(2));

      // reset で巻き戻し
      s1.reset();
      expect(s1.next()).toBe(s2.at(0));
      expect(s1.next()).toBe(s2.at(1));
    });
  });
});
