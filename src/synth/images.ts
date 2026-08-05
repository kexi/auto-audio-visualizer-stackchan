/**
 * Image store — the pixels behind a Patch's `images` references.
 *
 * The Patch itself only ever carries `{ name, hash }`: the same picture on the
 * next machine reproduces the same Look, and a Patch stays a few kB of JSON.
 * This module is the other half of that contract — it owns the actual bytes,
 * keyed by the SHA-256 of the *original file*, and survives a reload via
 * IndexedDB.
 *
 * Responsibilities kept deliberately narrow:
 * - hash + decode (SVG is rasterized here, everything else goes through
 *   createImageBitmap)
 * - persist to / hydrate from IndexedDB
 * - hand a decoded, GPU-uploadable source to whoever asks
 *
 * GL textures are NOT created here. The scene owns them (it owns the context),
 * caches them by hash, and drops them on dispose.
 *
 * ORIENTATION CONTRACT: decoded pixels come out bottom-row-first, i.e. already
 * in GL orientation, so t=0 is the bottom of the picture — the same convention
 * an FBO colour attachment has. Uploaders therefore never touch
 * UNPACK_FLIP_Y_WEBGL, which matters because that flag is *ignored* for
 * ImageBitmap sources; getting this wrong shows up as an upside-down logo and
 * nothing else. The flip is done here instead: via createImageBitmap's
 * imageOrientation, or by drawing flipped into the rasterization canvas.
 *
 * Everything degrades instead of throwing: no IndexedDB (Node tests, private
 * mode) → memory-only; no createImageBitmap → the record stays undecoded and
 * the scene falls back to its transparent dummy.
 */

/** Long edge, in px, an SVG is rasterized to. */
export const SVG_RASTER_SIZE = 2048;

const DB_NAME = 'vj-images';
const DB_VERSION = 1;
const STORE = 'images';

/** Anything WebGL can take straight into texImage2D. */
export type DecodedImage = ImageBitmap | HTMLCanvasElement | HTMLImageElement;

export interface ImageMeta {
  name: string;
  /** SHA-256 hex of the original file bytes. */
  hash: string;
  mime: string;
  /** Decoded pixel size (post-rasterization for SVG). 0 while undecoded. */
  width: number;
  height: number;
  addedAt: number;
}

export interface StoredImage extends ImageMeta {
  /** Original bytes, exactly as loaded — the hash is taken over these. */
  blob: Blob;
  /** Decoded pixels, or null when decoding failed / has not run yet. */
  decoded: DecodedImage | null;
}

/** hash → record. The single source of truth at runtime. */
const byHash = new Map<string, StoredImage>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch (e) {
      console.error('[vj-images] listener threw:', e);
    }
  }
}

/** 画像一覧の変更購読（UI 再描画用）。unsubscribe を返す。 */
export function subscribeImages(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * SHA-256 hex of raw bytes. Deterministic and content-addressed: the same file
 * always yields the same id, on any machine, which is what makes a Patch's
 * image reference portable.
 */
export async function hashBytes(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('[vj-images] crypto.subtle is unavailable; cannot hash image bytes');
  }
  // digest takes a BufferSource, so a view is hashed over its own byteOffset /
  // byteLength — no copy needed to keep a view over a larger buffer honest.
  return toHex(await subtle.digest('SHA-256', bytes));
}

export async function hashBlob(blob: Blob): Promise<string> {
  return hashBytes(await blob.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

export function isSvg(mime: string, name: string): boolean {
  return mime === 'image/svg+xml' || /\.svg$/i.test(name);
}

/** Long edge → SVG_RASTER_SIZE, preserving aspect. Never upscales past it. */
function rasterSize(w: number, h: number): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= 0) return { w: SVG_RASTER_SIZE, h: SVG_RASTER_SIZE };
  const k = SVG_RASTER_SIZE / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Draw `src` into a fresh canvas of the given size, flipped into GL orientation. */
function flippedCanvas(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.translate(0, h);
  ctx.scale(1, -1);
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

/**
 * Rasterize an SVG at SVG_RASTER_SIZE on its long edge.
 *
 * createImageBitmap does not accept SVG reliably across browsers, so the blob
 * goes through an <img> and a canvas — which is also where the GL flip happens.
 * An SVG without intrinsic dimensions reports 0×0 in some browsers; a square
 * fallback keeps it visible instead of silently producing nothing.
 */
async function rasterizeSvg(blob: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG failed to load'));
      img.src = url;
    });
    const size = rasterSize(
      img.naturalWidth || img.width || SVG_RASTER_SIZE,
      img.naturalHeight || img.height || SVG_RASTER_SIZE,
    );
    return flippedCanvas(img, size.w, size.h);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeBlob(blob: Blob, mime: string, name: string): Promise<DecodedImage> {
  if (isSvg(mime, name)) return rasterizeSvg(blob);
  if (typeof createImageBitmap !== 'function') {
    throw new Error('createImageBitmap is unavailable');
  }
  try {
    // The only place the flip is free: the decoder does it while decoding.
    return await createImageBitmap(blob, { imageOrientation: 'flipY' });
  } catch {
    // Older decoders reject the option — pay for a canvas copy instead rather
    // than silently handing back an upside-down image.
    const natural = await createImageBitmap(blob);
    try {
      return flippedCanvas(natural, natural.width, natural.height);
    } finally {
      natural.close();
    }
  }
}

/**
 * Decoded pixel size, whichever concrete type came back. Duck-typed rather than
 * instanceof-checked so the module also imports cleanly outside a DOM.
 */
function sizeOf(decoded: DecodedImage): { width: number; height: number } {
  const natural = decoded as { naturalWidth?: number; naturalHeight?: number };
  if (typeof natural.naturalWidth === 'number' && natural.naturalWidth > 0) {
    return { width: natural.naturalWidth, height: natural.naturalHeight ?? 0 };
  }
  return { width: decoded.width, height: decoded.height };
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

interface PersistedImage {
  hash: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  addedAt: number;
  blob: Blob;
}

function openDb(): Promise<IDBDatabase | null> {
  const idb = globalThis.indexedDB;
  if (!idb) return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(DB_NAME, DB_VERSION);
    } catch (e) {
      console.warn('[vj-images] IndexedDB unavailable; images will not persist:', e);
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'hash' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn('[vj-images] IndexedDB open failed; images will not persist:', req.error);
      resolve(null);
    };
    req.onblocked = () => resolve(null);
  });
}

function persist(record: PersistedImage): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) {
          resolve();
          return;
        }
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(record);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            console.warn('[vj-images] failed to persist image:', tx.error);
            db.close();
            resolve();
          };
        } catch (e) {
          console.warn('[vj-images] failed to persist image:', e);
          db.close();
          resolve();
        }
      }),
  );
}

function readAll(): Promise<PersistedImage[]> {
  return openDb().then(
    (db) =>
      new Promise<PersistedImage[]>((resolve) => {
        if (!db) {
          resolve([]);
          return;
        }
        try {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).getAll();
          req.onsuccess = () => {
            db.close();
            resolve((req.result as PersistedImage[]) ?? []);
          };
          req.onerror = () => {
            console.warn('[vj-images] failed to read images:', req.error);
            db.close();
            resolve([]);
          };
        } catch (e) {
          console.warn('[vj-images] failed to read images:', e);
          db.close();
          resolve([]);
        }
      }),
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Take a file into the store: hash it, decode it, persist it.
 *
 * Re-adding the same bytes is idempotent — the hash already exists, so the
 * decoded pixels are reused and only the display name is refreshed.
 */
export async function putImage(name: string, blob: Blob): Promise<ImageMeta> {
  const hash = await hashBlob(blob);
  const mime = blob.type || (isSvg('', name) ? 'image/svg+xml' : 'application/octet-stream');

  const existing = byHash.get(hash);
  if (existing && existing.decoded) {
    // Same pixels under a new name: keep the decode, update the label.
    if (existing.name !== name) {
      existing.name = name;
      notify();
    }
    return metaOf(existing);
  }

  let decoded: DecodedImage | null = null;
  try {
    decoded = await decodeBlob(blob, mime, name);
  } catch (e) {
    console.warn(`[vj-images] could not decode "${name}":`, e);
  }
  const size = decoded ? sizeOf(decoded) : { width: 0, height: 0 };

  const record: StoredImage = {
    name,
    hash,
    mime,
    width: size.width,
    height: size.height,
    addedAt: existing?.addedAt ?? Date.now(),
    blob,
    decoded,
  };
  byHash.set(hash, record);
  notify();

  await persist({
    hash,
    name,
    mime,
    width: record.width,
    height: record.height,
    addedAt: record.addedAt,
    blob,
  });

  return metaOf(record);
}

function metaOf(record: StoredImage): ImageMeta {
  return {
    name: record.name,
    hash: record.hash,
    mime: record.mime,
    width: record.width,
    height: record.height,
    addedAt: record.addedAt,
  };
}

/**
 * Look up by content hash first, then by display name.
 *
 * Hash is the contract; the name lookup only exists so a Patch authored against
 * "logo.png" still finds a re-exported file the user considers the same one.
 */
export function getImage(hashOrName: string): StoredImage | undefined {
  const direct = byHash.get(hashOrName);
  if (direct) return direct;
  for (const record of byHash.values()) {
    if (record.name === hashOrName) return record;
  }
  return undefined;
}

/** 追加順（古い順）の一覧。UI 表示用。 */
export function listImages(): ImageMeta[] {
  return Array.from(byHash.values())
    .sort((a, b) => a.addedAt - b.addedAt || a.name.localeCompare(b.name))
    .map(metaOf);
}

/** テスト用。ストアを空にする（IndexedDB には触らない）。 */
export function clearImageCache(): void {
  byHash.clear();
  notify();
}

let hydration: Promise<void> | null = null;

/**
 * Restore the store from IndexedDB. Idempotent and safe to call from several
 * places (the scene and the UI both want it) — the first call owns the work.
 */
export function loadImages(): Promise<void> {
  if (hydration) return hydration;
  hydration = (async () => {
    const records = await readAll();
    for (const rec of records) {
      if (byHash.has(rec.hash)) continue;
      let decoded: DecodedImage | null = null;
      try {
        decoded = await decodeBlob(rec.blob, rec.mime, rec.name);
      } catch (e) {
        console.warn(`[vj-images] could not decode stored "${rec.name}":`, e);
      }
      const size = decoded ? sizeOf(decoded) : { width: rec.width, height: rec.height };
      byHash.set(rec.hash, {
        name: rec.name,
        hash: rec.hash,
        mime: rec.mime,
        width: size.width,
        height: size.height,
        addedAt: rec.addedAt,
        blob: rec.blob,
        decoded,
      });
    }
    if (records.length > 0) notify();
  })();
  return hydration;
}

/** base64 → Blob。Bridge 経由の setImage が使う。 */
export function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
