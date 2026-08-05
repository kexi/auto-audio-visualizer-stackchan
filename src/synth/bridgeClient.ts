import { getSynthControl } from './control';
import { inlineCatalog } from './generators';
import type { TimelineOp } from './timeline';

/**
 * Control Bridge (browser side).
 *
 * External Control Interface（control.ts）は transport-agnostic に作ってある。
 * このモジュールはその上に載る最初の「外から来る」トランスポートで、中継サーバ
 * （scripts/vj-bridge.mjs）経由で CLI から control を叩けるようにする。
 *
 * 設計方針:
 * - 本番の VJ 中に事故らないよう、URL に `bridge` パラメータがあるときだけ有効。
 *   何も指定しなければ WebSocket を1本も張らない（副作用ゼロ）。
 * - プロトコルの純粋な部分（URL ゲートとメッセージのルーティング）を
 *   parseBridgePort / handleBridgeMessage に切り出し、ソケットの生死管理だけを
 *   initBridgeClient に残す。こうするとテストが実ネットワーク無しで書ける。
 */

/** `?bridge=1` のときに使う既定ポート。scripts/vj-bridge.mjs の既定と揃えること。 */
const DEFAULT_BRIDGE_PORT = 7877;

/** 切断後の再接続間隔。ライブ中に手で貼り直さずに済む程度の短さ。 */
const RECONNECT_DELAY_MS = 3000;

export interface BridgeClientHandle {
  close(): void;
}

/**
 * URL の query から Bridge の接続先ポートを決める。接続しないなら null。
 *
 * `bridge=1` / `bridge=true` / `bridge`（値なし）→ 既定ポート、
 * `bridge=<2..65535>` → そのポート、それ以外は「無効な指定」として接続しない。
 * タイプミスで意図しないポートへ繋ぎにいくより、繋がない方が安全。
 */
export function parseBridgePort(search: string): number | null {
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get('bridge');
  } catch {
    return null;
  }
  if (raw === null) return null;
  // 値なし（`?bridge`）は URLSearchParams だと空文字になる。
  if (raw === '' || raw === '1' || raw === 'true') return DEFAULT_BRIDGE_PORT;
  // parseInt だと '80abc' が 80 になってしまうので、数字だけの文字列に限定する。
  if (!/^\d+$/.test(raw)) return null;
  const port = Number(raw);
  return port >= 2 && port <= 65535 ? port : null;
}

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------

type DispatchResult = { ok: true; result: unknown } | { ok: false; error: string };

function ok(result: unknown): DispatchResult {
  return { ok: true, result };
}

function fail(error: string): DispatchResult {
  return { ok: false, error };
}

/**
 * method 名 → control 呼び出し。
 *
 * getSynthControl() をここで呼ぶ（モジュールトップで束縛しない）のは、facade が
 * シーン切り替えを跨いで有効とはいえ、テストから差し替えられる形にしておきたい
 * ためと、将来 facade が差し替え可能になったときに追随させるため。
 */
function dispatch(method: string, params: Record<string, unknown> | undefined): DispatchResult {
  const control = getSynthControl();
  switch (method) {
    case 'getState':
      return ok(control.getState());

    case 'getCatalog':
      // def だけを返す。emit は GLSL を組み立てるクロージャで JSON 化できないし、
      // CLI 側が欲しいのは parameters / cost などのメタデータだけ。
      return ok(inlineCatalog.all().map((g) => g.def));

    case 'proposePatch':
      if (params === undefined || !('patch' in params)) {
        return fail('proposePatch requires params.patch');
      }
      // patch の中身は proposePatch（gatePatchProposal）が検証して issues を返す。
      return ok(control.proposePatch(params.patch));

    case 'proposeSeed': {
      const seed = params?.seed;
      if (typeof seed !== 'string') return fail('proposeSeed requires params.seed as string');
      control.proposeSeed(seed);
      return ok({ ok: true });
    }

    case 'applyTimelineOp': {
      const op = params?.op;
      if (typeof op !== 'object' || op === null) {
        return fail('applyTimelineOp requires params.op as object');
      }
      // op の妥当性は applyTimelineOp 側が判定して issue を返すので、
      // ここでは「オブジェクトであること」しか見ない。
      return ok(control.applyTimelineOp(op as TimelineOp));
    }

    case 'fireExternal': {
      const id = params?.id;
      if (typeof id !== 'string') return fail('fireExternal requires params.id as string');
      control.fireExternal(id);
      return ok({ ok: true });
    }

    case 'startRecording':
      control.startRecording();
      return ok({ ok: true });

    case 'stopRecording': {
      // 未開始なら null が返る。CLI 側が分岐しやすいよう ok も添える。
      const json = control.stopRecording();
      return ok({ ok: json !== null, json });
    }

    case 'loadRecording': {
      const json = params?.json;
      if (typeof json !== 'string') return fail('loadRecording requires params.json as string');
      return ok(control.loadRecording(json));
    }

    default:
      return fail(`unknown method: ${method}`);
  }
}

/** 受信フレーム1件を処理して、返すべきレスポンスフレームを返す（返さない場合は null）。 */
export function handleBridgeMessage(raw: string): object | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 壊れたフレームは黙って捨てる。id が読めない以上、返す相手を特定できない。
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const frame = parsed as { id?: unknown; method?: unknown; params?: unknown };
  if (typeof frame.id !== 'number' || typeof frame.method !== 'string') return null;
  const id = frame.id;

  const rawParams = frame.params;
  const params =
    typeof rawParams === 'object' && rawParams !== null && !Array.isArray(rawParams)
      ? (rawParams as Record<string, unknown>)
      : undefined;

  try {
    const out = dispatch(frame.method, params);
    return out.ok ? { id, result: out.result } : { id, error: out.error };
  } catch (e) {
    // ハンドラの例外で WebSocket を落とさない。シーン側の失敗はあくまで
    // 「そのリクエストの失敗」として返し、接続は生かしたままにする。
    return { id, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Socket lifecycle
// ---------------------------------------------------------------------------

/**
 * URL に `bridge` パラメータがあるときだけ中継サーバへ接続する。
 * 無効・未指定なら何もせず null を返す。
 */
export function initBridgeClient(): BridgeClientHandle | null {
  // location が無い環境（Node のテストなど）でも落ちないように読む。
  const loc = globalThis.location as Location | undefined;
  const port = parseBridgePort(loc?.search ?? '');
  if (port === null) return null;

  const SocketCtor = globalThis.WebSocket;
  if (typeof SocketCtor !== 'function') return null;

  // アプリは vite の basicSsl により https で配信されるが、ws://127.0.0.1 は
  // mixed content としてブロックされない: ループバックは仕様上
  // "potentially trustworthy origin" と定義されているため。
  // ホスト名に localhost ではなく 127.0.0.1 を使うのは、環境によって localhost が
  // ::1 に解決され、IPv4 で listen している中継サーバに繋がらないのを避けるため。
  const url = `ws://127.0.0.1:${port}`;

  let disposed = false;
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  // 切断ログは状態が変わったときだけ出す。3秒ごとの再試行でコンソールを
  // 埋めると、肝心の描画側の警告が見えなくなる。
  let downLogged = false;

  const scheduleReconnect = (): void => {
    // タイマは常に1本。onerror と onclose が両方来ても二重には張らない。
    if (disposed || retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  };

  /** 現行ソケットが落ちたときの後始末。同じソケットに対して冪等。 */
  const handleDown = (ws: WebSocket): void => {
    if (socket !== ws) return;
    socket = null;
    if (!downLogged) {
      console.info(`[vj-bridge] disconnected from ${url}; retrying every 3s`);
      downLogged = true;
    }
    scheduleReconnect();
  };

  function connect(): void {
    if (disposed) return;
    let ws: WebSocket;
    try {
      ws = new SocketCtor(url);
    } catch {
      // コンストラクタが投げるのは URL 不正くらいだが、投げても諦めずに retry する。
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.onopen = (): void => {
      downLogged = false;
      console.info(`[vj-bridge] connected to ${url}`);
      // 中継サーバはロール別にソケットを仕分けるので、まず名乗る。
      ws.send(JSON.stringify({ hello: 'synth' }));
    };

    ws.onmessage = (ev: MessageEvent): void => {
      if (typeof ev.data !== 'string') return;
      const response = handleBridgeMessage(ev.data);
      if (response !== null) ws.send(JSON.stringify(response));
    };

    ws.onclose = (): void => handleDown(ws);
    ws.onerror = (): void => handleDown(ws);
  }

  connect();

  return {
    close(): void {
      disposed = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      const ws = socket;
      socket = null;
      ws?.close();
    },
  };
}
