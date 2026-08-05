import type { RelayRoom } from './relay';

/**
 * Worker のバインディング。wrangler.jsonc の `assets.binding` と
 * `durable_objects.bindings[].name` と名前を一致させること（ここを直したら
 * あちらも直す）。
 */
export interface Env {
  /** `dist/` に置かれたビルド済みアプリ。静的アセット配信用。 */
  ASSETS: Fetcher;
  /** room ごとに 1 インスタンス立つ中継。 */
  RELAY_ROOM: DurableObjectNamespace<RelayRoom>;
}
