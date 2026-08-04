import { describe, expect, it } from 'vitest';

// 同じディレクトリの .ts をソース文字列として一括取得する。
// node の fs を使わないことで、tsconfig.app.json (DOM のみ) のままで
// 型チェックできる。
const sources = import.meta.glob('./*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Split so a plain grep for the forbidden call does not flag this test file.
const FORBIDDEN = 'Math' + '.random';

describe('scenes determinism', () => {
  it('src/scenes has no non-deterministic global RNG in source files', () => {
    const entries = Object.entries(sources).filter(([path]) => !path.endsWith('.test.ts'));
    expect(entries.length, 'expected at least one scene source file').toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const [path, src] of entries) {
      if (src.includes(FORBIDDEN)) offenders.push(path);
    }
    expect(offenders, `${FORBIDDEN} found in: ${offenders.join(', ')}`).toEqual([]);
  });
});
