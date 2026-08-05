#!/usr/bin/env node
/**
 * vj-ctl — vj-bridge 経由でブラウザ内の SynthControl を 1 コマンドだけ叩く CLI。
 *
 * 1 実行 = 1 接続。常駐させないのは、AI Director（Claude Code など）から
 * 「1 コマンド叩いて JSON を読む」形で使うのが主用途で、セッションを跨いだ
 * 状態を CLI 側に持たせたくないため。状態はすべてブラウザ側が正。
 *
 * 出力の約束:
 *   - 成功            → 結果 JSON を stdout（整形）、exit 0
 *   - ok:false        → issues / issue を含む結果 JSON を stdout、ヒントを stderr、exit 1
 *   - 通信/引数エラー → {"error":"..."} を stdout、ヒントを stderr、exit 1
 *   - record stop     → recording JSON を再整形せずそのまま stdout（> recording.json 用）
 */
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';

const DEFAULT_PORT = 7877;

/** 接続からコマンド完了までの全体上限。bridge も synth も無言のまま固まる場合の保険。 */
const OVERALL_TIMEOUT_MS = 20_000;

// 由来: src/synth/types.ts の DEFAULT_TRANSITION と src/ui/TimelinePanel.tsx の
// TRANSITION_PRESETS を写したもの（CLI は .ts を import できないため複製）。
// default = DEFAULT_TRANSITION / slow = 各 ms を 2 倍 / cut = 全て 120ms。easing は 3 つとも 'easeInOut'。
const TRANSITION_PRESETS = {
  default: {
    paletteMs: 1200,
    parameterMs: 800,
    modulationMs: 1000,
    topologyMs: 2000,
    easing: 'easeInOut',
  },
  slow: {
    paletteMs: 2400,
    parameterMs: 1600,
    modulationMs: 2000,
    topologyMs: 4000,
    easing: 'easeInOut',
  },
  cut: {
    paletteMs: 120,
    parameterMs: 120,
    modulationMs: 120,
    topologyMs: 120,
    easing: 'easeInOut',
  },
};

const USAGE = `使い方: node scripts/vj-ctl.mjs <command> [options]

  state                        現在の SynthControlState を表示
  catalog                      Generator カタログ（id / category / tags / parameters）を表示
  seed <seed>                  seed から派生した Patch へ即遷移
  patch <file.json>            VisualPatch を即適用（検証に落ちると issues が返る）
  event add --in <sec>|--bar <n> [--seed <s>] [--patch <file>] [--label <s>]
                               [--transition default|slow|cut]
                               「N 秒後 / N 小節後に切り替える」イベントを Timeline に追加
  event remove <id>            イベントを削除
  lock <sec>                   今から <sec> 秒間 Timeline をロックする（相対指定）
  fire <externalId>            external anchor のイベントを手動発火
  record start                 録画開始
  record stop                  録画を止めて recording JSON を stdout へ（> recording.json）
  load <recording.json>        recording を読み込んで Timeline を復元

共通オプション:
  --port <n>                   bridge のポート（既定 ${DEFAULT_PORT}）
  --help                       このヘルプ

例:
  node scripts/vj-ctl.mjs state
  node scripts/vj-ctl.mjs seed "humid-night-market"
  node scripts/vj-ctl.mjs event add --in 30 --seed rainy-qilou --transition slow
  node scripts/vj-ctl.mjs event add --bar 8 --patch /tmp/patch.json
  node scripts/vj-ctl.mjs lock 60
  node scripts/vj-ctl.mjs record stop > recording.json`;

/** 引数の誤り。main が usage を出して exit 1 にする。 */
class UsageError extends Error {}

/** bridge / synth が返したエラー文字列。ローカルの例外と区別してヒントを出し分ける。 */
class BridgeError extends Error {}

// process.exit は書き込み途中の stdout を切り落とすことがあるので使わない。
// 例外で main まで戻し、exitCode を立てて自然に終了させる。
function usageError(message) {
  throw new UsageError(message);
}

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------

/** `--name value` と位置引数だけを解釈する。負数を値に取れるよう `--` 始まりだけをフラグ扱いにする。 */
function parseArgv(argv) {
  const positional = [];
  const flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (name === 'help') {
      flags.set('help', true);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      usageError(`--${name} には値が必要です`);
    }
    flags.set(name, value);
    i++;
  }
  return { positional, flags };
}

function numberFlag(flags, name) {
  const raw = flags.get(name);
  const n = Number(raw);
  if (!Number.isFinite(n)) usageError(`--${name} には数値を指定してください（${raw}）`);
  return n;
}

function readTextFile(path, what) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    return usageError(`${what} を読めません: ${path} (${e.message})`);
  }
}

function readJsonFile(path, what) {
  const text = readTextFile(path, what);
  try {
    return JSON.parse(text);
  } catch (e) {
    return usageError(`${what} が JSON として不正です: ${path} (${e.message})`);
  }
}

// ---------------------------------------------------------------------------
// 接続
// ---------------------------------------------------------------------------

function openConnection(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const pending = new Map();
  let nextId = 1;

  const ready = new Promise((resolve, reject) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({ hello: 'ctl' }));
      resolve();
    });
    // open 済みなら no-op。open 前の ECONNREFUSED をここで拾う。
    ws.on('error', reject);
  });

  function rejectAll(err) {
    for (const entry of pending.values()) entry.rej(err);
    pending.clear();
  }

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const entry = pending.get(msg?.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.error !== undefined) entry.rej(new BridgeError(String(msg.error)));
    else entry.res(msg.result);
  });

  ws.on('close', () => rejectAll(new BridgeError('bridge との接続が切れました')));
  ws.on('error', (err) => rejectAll(err));

  return {
    ready,
    request(method, params) {
      const id = nextId++;
      return new Promise((res, rej) => {
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
      // close ハンドシェイクを返さない相手でもプロセスを残さない。unref してあるので
      // 正常終了時にこのタイマーが待ち時間を作ることはない。
      setTimeout(() => ws.terminate(), 1000).unref();
    },
    /** 全体タイムアウト用。イベントループを空にして自然終了させる。 */
    abort() {
      ws.terminate();
    },
  };
}

// ---------------------------------------------------------------------------
// コマンド
// ---------------------------------------------------------------------------

function jsonOut(value) {
  return { ok: true, output: `${JSON.stringify(value, null, 2)}\n` };
}

/**
 * control が返す {ok, issues?/issue?} をそのまま結果として出す。
 * ok:false は「通信は成功したが提案が却下された」状態なので、{"error"} に潰さず
 * issues を残したまま exit 1 にする（呼び出し側が直して投げ直せるように）。
 */
function resultOut(result, extra, hint) {
  const payload = { ...result, ...extra };
  const ok = result?.ok !== false;
  return { ok, output: `${JSON.stringify(payload, null, 2)}\n`, hint: ok ? undefined : hint };
}

async function buildEventAdd(conn, flags) {
  // 相対指定（N 秒後 / N 小節後）を絶対 anchor に直すには、いま何秒・何小節かが要る。
  const state = await conn.request('getState');

  let start;
  if (flags.has('bar')) {
    // barCount は barPhase 込みの小数で来ることがあるので、現在の小節頭を基準にする。
    start = { kind: 'bar', bar: Math.floor(state.barCount) + numberFlag(flags, 'bar') };
  } else if (flags.has('in')) {
    start = { kind: 'seconds', atSec: state.nowSec + numberFlag(flags, 'in') };
  } else {
    usageError('event add には --in <sec> か --bar <n> のどちらかが必要です');
  }

  const intent = {};
  if (flags.has('label')) intent.label = flags.get('label');
  if (flags.has('seed')) intent.seed = flags.get('seed');
  if (flags.has('patch')) intent.patch = readJsonFile(flags.get('patch'), 'patch');
  if (Object.keys(intent).length === 0) {
    usageError('intent が空です（--label / --seed / --patch のいずれかを指定してください）');
  }

  const presetId = flags.has('transition') ? flags.get('transition') : 'default';
  const transition = TRANSITION_PRESETS[presetId];
  if (!transition) {
    usageError(`--transition は ${Object.keys(TRANSITION_PRESETS).join(' | ')} のいずれかです`);
  }

  return {
    // 後から remove しやすいよう、由来が分かる接頭辞 + 実行時刻。
    id: `ctl-${Date.now()}`,
    start,
    duration: { kind: 'untilNext' },
    intent,
    transition,
    confidence: 1,
    locked: false,
  };
}

async function run(conn, positional, flags) {
  const [command, ...rest] = positional;

  switch (command) {
    case 'state':
      return jsonOut(await conn.request('getState'));

    case 'catalog':
      return jsonOut(await conn.request('getCatalog'));

    case 'seed': {
      if (rest.length === 0) usageError('seed には <seed> が必要です');
      return jsonOut(await conn.request('proposeSeed', { seed: rest[0] }));
    }

    case 'patch': {
      if (rest.length === 0) usageError('patch には <file.json> が必要です');
      const patch = readJsonFile(rest[0], 'patch');
      const result = await conn.request('proposePatch', { patch });
      return resultOut(
        result,
        undefined,
        'Patch が検証ゲートに落ちました。issues を見て直してください。',
      );
    }

    case 'event': {
      const sub = rest[0];
      if (sub === 'add') {
        const event = await buildEventAdd(conn, flags);
        const result = await conn.request('applyTimelineOp', { op: { op: 'add', event } });
        return resultOut(
          result,
          { event },
          'イベントを追加できませんでした。issue を確認してください。',
        );
      }
      if (sub === 'remove') {
        if (rest.length < 2) usageError('event remove には <id> が必要です');
        const result = await conn.request('applyTimelineOp', { op: { op: 'remove', id: rest[1] } });
        return resultOut(
          result,
          { id: rest[1] },
          'イベントを削除できませんでした（ロック中か id 違い）。',
        );
      }
      return usageError('event のサブコマンドは add か remove です');
    }

    case 'lock': {
      if (rest.length === 0) usageError('lock には <sec>（今から何秒ロックするか）が必要です');
      const sec = Number(rest[0]);
      if (!Number.isFinite(sec)) usageError(`lock の <sec> は数値です（${rest[0]}）`);
      // control 側は絶対秒を期待する。相対 → 絶対の変換は CLI の仕事。
      const state = await conn.request('getState');
      const lockedUntilSec = state.nowSec + sec;
      const result = await conn.request('applyTimelineOp', {
        op: { op: 'setLockedUntil', sec: lockedUntilSec },
      });
      return resultOut(result, { lockedUntilSec }, 'ロックを設定できませんでした。');
    }

    case 'fire': {
      if (rest.length === 0) usageError('fire には <externalId> が必要です');
      return jsonOut(await conn.request('fireExternal', { id: rest[0] }));
    }

    case 'record': {
      const sub = rest[0];
      if (sub === 'start') return jsonOut(await conn.request('startRecording'));
      if (sub === 'stop') {
        const result = await conn.request('stopRecording');
        if (!result?.ok || typeof result.json !== 'string') {
          return {
            ok: false,
            output: `${JSON.stringify({ error: 'not recording' })}\n`,
            hint: '録画していません。先に `record start` を実行してください。',
          };
        }
        // 再整形しない: この出力をそのまま `load` に食わせられることが契約。
        // 末尾改行だけはシェルで扱いやすいように足す（JSON としては同値）。
        return { ok: true, output: `${result.json}\n` };
      }
      return usageError('record のサブコマンドは start か stop です');
    }

    case 'load': {
      if (rest.length === 0) usageError('load には <recording.json> が必要です');
      // 中身は control 側が検証するので、ここでは読めることだけ確かめて素通しする。
      const json = readTextFile(rest[0], 'recording');
      const result = await conn.request('loadRecording', { json });
      return resultOut(
        result,
        undefined,
        'recording を読み込めませんでした。issues を確認してください。',
      );
    }

    default:
      return usageError(`不明なコマンド: ${command}`);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function fail(message, hint) {
  process.stdout.write(`${JSON.stringify({ error: message })}\n`);
  if (hint) process.stderr.write(`${hint}\n`);
  process.exitCode = 1;
}

function hintFor(message, port) {
  if (message.includes('no synth connected')) {
    return 'アプリを `?scene=semantic-synth&bridge=1` 付きで開いているか確認してください。';
  }
  if (message.includes('ECONNREFUSED') || message.includes('接続が切れました')) {
    return `ws://127.0.0.1:${port} につながりません。\`pnpm bridge\` が起動しているか確認してください。`;
  }
  if (message.includes('timeout waiting for synth')) {
    return 'ブラウザが応答していません。タブが背面に回っていないか確認してください。';
  }
  return undefined;
}

async function main() {
  let port = DEFAULT_PORT;
  let conn = null;
  let overall = null;
  let timedOut = false;

  try {
    const { positional, flags } = parseArgv(process.argv.slice(2));
    if (flags.get('help') === true || positional.length === 0) {
      usageError('コマンドを指定してください');
    }
    if (flags.has('port')) port = numberFlag(flags, 'port');

    conn = openConnection(port);
    // 通信が固まったまま端末を占有しないための最終防衛線。
    overall = setTimeout(() => {
      timedOut = true;
      // 接続が拒否されずに沈黙する環境（WSL 等）ではここが唯一の手掛かりになるので、
      // bridge 未起動とブラウザ無応答の両方を疑えるヒントを出す。
      fail(
        `timeout after ${OVERALL_TIMEOUT_MS / 1000}s`,
        `\`pnpm bridge\` が起動しているか（ws://127.0.0.1:${port}）、ブラウザが応答しているか確認してください。`,
      );
      conn.abort();
    }, OVERALL_TIMEOUT_MS);

    await conn.ready;
    const res = await run(conn, positional, flags);
    process.stdout.write(res.output);
    if (!res.ok) {
      if (res.hint) process.stderr.write(`${res.hint}\n`);
      process.exitCode = 1;
    }
  } catch (e) {
    if (timedOut) {
      // 報告済み。abort の後始末で飛んでくる例外はここで握りつぶす。
    } else if (e instanceof UsageError) {
      process.stderr.write(`vj-ctl: ${e.message}\n\n${USAGE}\n`);
      process.exitCode = 1;
    } else {
      const detail = e?.message ?? String(e);
      fail(detail, hintFor(detail, port));
    }
  } finally {
    if (overall) clearTimeout(overall);
    conn?.close();
  }
}

await main();
