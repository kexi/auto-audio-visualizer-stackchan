// vj-tweak.mjs の route 追従バグ(operator の差し替え/削除後に古い route が
// 残ってしまう不具合)の回帰テスト。vj-ctl.mjs をネットワーク不要のスタブに
// 差し替え、実際の CLI を子プロセスとして起動して stdout/stderr を検証する。
// ライブの VJ_URL には一切接続しない。
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const VJ_TWEAK_PATH = join(SCRIPT_DIR, 'vj-tweak.mjs');
const REAL_CACHE_PATH = join(SCRIPT_DIR, '.vj-catalog-cache.json');

const FIXTURE_CATALOG = [
  {
    id: 'noiseSource',
    version: 1,
    category: 'source',
    parameters: [{ id: 'amount', kind: 'number', min: 0, max: 1, default: 0.5, modulatable: true }],
  },
  {
    id: 'repeat',
    version: 1,
    category: 'modifier',
    parameters: [{ id: 'count', kind: 'int', min: 1, max: 8, default: 1, modulatable: false }],
  },
  {
    id: 'bathroomGlaze',
    version: 1,
    category: 'material',
    parameters: [{ id: 'tint', kind: 'number', min: 0, max: 1, default: 0.2, modulatable: true }],
  },
  {
    id: 'riso',
    version: 1,
    category: 'material',
    // 意図的に "tint" を持たない — mat0 をこの generator に差し替えると
    // mat0.tint を target にしていた route が壊れることを再現する。
    parameters: [{ id: 'hue', kind: 'number', min: 0, max: 360, default: 0, modulatable: true }],
  },
];

const FIXTURE_PATCH = {
  schemaVersion: 1,
  seed: 'fixture',
  operators: [
    { id: 'src0', generatorId: 'noiseSource', generatorVersion: 1, parameters: { amount: 0.5 } },
    { id: 'mod0', generatorId: 'repeat', generatorVersion: 1, parameters: { count: 1 } },
    { id: 'mod1', generatorId: 'repeat', generatorVersion: 1, parameters: { count: 1 } },
    { id: 'mat0', generatorId: 'bathroomGlaze', generatorVersion: 1, parameters: { tint: 0.2 } },
  ],
  routes: [
    // mat0 を差し替えると壊れる(riso に tint が無いため)
    { source: 'audio:level', target: 'mat0.tint', amount: 0.1, polarity: 'unipolar', smoothing: 1 },
    // mod1 を削除すると壊れる(source が operator:mod1 を指しているため)
    {
      source: 'operator:mod1',
      target: 'src0.amount',
      amount: 0.05,
      polarity: 'unipolar',
      smoothing: 1,
    },
    // どちらの変更でも壊れない対照 route(生き残るはず)
    {
      source: 'audio:bass',
      target: 'src0.amount',
      amount: 0.2,
      polarity: 'unipolar',
      smoothing: 1,
    },
  ],
  palette: { mode: 'mono', hueOffset: 0, saturation: 30, lightness: 50 },
  composition: { symmetry: 1, scale: 1, speed: 0.2 },
  qualityTier: 'medium',
};

/** vj-ctl.mjs のネットワーク I/O をスタブする偽実装。state/catalog だけを返す。 */
function stubSource() {
  return `
// vj-tweak.mjs は vj-ctl.mjs を [VJ_CTL_PATH, '--url', url, command, ...] で spawn する。
// 子プロセスの argv は [node, script, '--url', url, command, ...] なので index 4。
const command = process.argv[4];
if (command === 'state') {
  process.stdout.write(JSON.stringify({ currentPatch: ${JSON.stringify(FIXTURE_PATCH)} }));
  process.exit(0);
}
if (command === 'catalog') {
  process.stdout.write(JSON.stringify(${JSON.stringify(FIXTURE_CATALOG)}));
  process.exit(0);
}
process.stderr.write('stub-vj-ctl: unexpected command "' + command + '" (this suite only allows state/catalog)\\n');
process.exit(1);
`;
}

let tmpDir;
let stubPath;
let savedCache; // Buffer | undefined — undefined means "本物のキャッシュは無かった"

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'vj-tweak-test-'));
  stubPath = join(tmpDir, 'vj-ctl-stub.mjs');
  writeFileSync(stubPath, stubSource());
  // このテストは --refresh-catalog を必ず付けるので実際には読まれないはずだが、
  // 本物の scripts/.vj-catalog-cache.json を書き換えてしまう副作用(loadCatalog の
  // ベストエフォート書き戻し)から開発者のローカル環境を守るため、退避しておく。
  try {
    savedCache = readFileSync(REAL_CACHE_PATH);
  } catch {
    savedCache = undefined;
  }
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedCache === undefined) {
    try {
      rmSync(REAL_CACHE_PATH);
    } catch {
      // 元々無かったので、無ければ何もしなくてよい
    }
  } else {
    writeFileSync(REAL_CACHE_PATH, savedCache);
  }
});

function runVjTweak(args) {
  return spawnSync(process.execPath, [VJ_TWEAK_PATH, '--dry-run', '--refresh-catalog', ...args], {
    encoding: 'utf8',
    env: { ...process.env, VJ_CTL_PATH: stubPath, VJ_URL: 'ws://stub.invalid/room/test' },
  });
}

describe('vj-tweak.mjs route reconciliation', () => {
  it('drops routes that reference an operator/parameter removed by swap or delete, and warns on stderr', () => {
    const result = runVjTweak(['mat0:=riso', '-mod1']);

    expect(result.status).toBe(0);

    const draft = JSON.parse(result.stdout);
    expect(draft.routes).toEqual([
      {
        source: 'audio:bass',
        target: 'src0.amount',
        amount: 0.2,
        polarity: 'unipolar',
        smoothing: 1,
      },
    ]);

    expect(result.stderr).toMatch(/dropping route/);
    expect(result.stderr).toMatch(/mat0\.tint/);
    expect(result.stderr).toMatch(/mod1/);
  });

  it('leaves routes untouched when no operator is swapped or deleted', () => {
    const result = runVjTweak(['src0.amount=0.9']);

    expect(result.status).toBe(0);
    const draft = JSON.parse(result.stdout);
    expect(draft.routes).toHaveLength(3);
    expect(result.stderr).not.toMatch(/dropping route/);
  });
});
