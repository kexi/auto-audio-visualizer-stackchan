import type { Env } from './env';

/**
 * VJ Overlay Tool を Cloudflare Worker 1 つで配る。
 *
 * この Worker がやることは 2 つだけ:
 *   1. `/room/<id>` の WebSocket Upgrade を、その room の Durable Object へ渡す
 *   2. それ以外はビルド済みアプリ（dist/）をそのまま返す
 *
 * 静的配信と中継を 1 つの Worker にまとめてあるのは、ブラウザから見て
 * **同一オリジン**にするため。別ホストの中継に繋ぐと https のページから
 * ws:// が張れず（mixed content）、証明書とドメインの用意が要る。
 */

export { RelayRoom } from './relay';

/**
 * room id の形式。8〜64 文字の [a-zA-Z0-9_-] だけを通す。
 *
 * ここを緩くしておくのは、room id が「意味のある名前」ではなく
 * 使い捨ての合鍵（scripts/vj-ctl.mjs の `room` が 128bit のランダムを吐く）だから。
 * 短すぎる id を弾くのは総当たりへの最低限の抵抗で、上限は DO 名の暴走防止。
 * base64url をそのまま入れられるよう `_` と `-` は許す。
 */
const ROOM_PATH = /^\/room\/([A-Za-z0-9_-]{8,64})$/;

function handleRoom(request: Request, env: Env, pathname: string): Response | Promise<Response> {
  const match = ROOM_PATH.exec(pathname);
  if (match === null) {
    return new Response('invalid room id\n', { status: 400 });
  }
  // Upgrade 以外で来たら、アプリの 404 に混ぜず理由を返す（URL の打ち間違いと
  // 「そもそも WebSocket で来ていない」を切り分けられるように）。
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('expected Upgrade: websocket\n', { status: 426 });
  }

  // room id → DO インスタンス。同じ id なら世界のどこから繋いでも同じ 1 台に
  // 集まる。これが「room ごとに中継が完全に分離している」ことの実体。
  return env.RELAY_ROOM.getByName(match[1]).fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // `/room` 配下は必ずここで判断する（wrangler.jsonc の run_worker_first で
    // アセット側に先を越されないようにしてある）。
    if (pathname === '/room' || pathname.startsWith('/room/')) {
      return handleRoom(request, env, pathname);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
