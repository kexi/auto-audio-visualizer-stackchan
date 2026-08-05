import { describe, expect, it } from 'vitest';
import { base64ToBlob, hashBlob, hashBytes, isSvg, SVG_RASTER_SIZE } from './images';

/**
 * Node ends here: IndexedDB, createImageBitmap and canvas all live in the
 * browser, so the persistence and decode paths are covered by the GPU/browser
 * tests instead. What matters here is the piece the Patch format depends on —
 * the content hash — and it must behave identically in both places.
 */

const bytes = (...values: number[]): Uint8Array<ArrayBuffer> => new Uint8Array(values);

/** btoa-based, so the test compiles against the DOM lib like the app does. */
function toBase64(raw: Uint8Array): string {
  let binary = '';
  for (const b of raw) binary += String.fromCharCode(b);
  return btoa(binary);
}

describe('synth/images hashing', () => {
  it('same bytes → same hash (deterministic, content-addressed)', async () => {
    const a = await hashBytes(bytes(1, 2, 3, 4));
    const b = await hashBytes(bytes(1, 2, 3, 4));
    expect(a).toBe(b);
  });

  it('different bytes → different hash', async () => {
    const a = await hashBytes(bytes(1, 2, 3, 4));
    const b = await hashBytes(bytes(1, 2, 3, 5));
    expect(a).not.toBe(b);
  });

  it('is SHA-256 hex (64 lowercase hex chars) with the known empty-input digest', async () => {
    const empty = await hashBytes(new Uint8Array(0));
    expect(empty).toMatch(/^[0-9a-f]{64}$/);
    expect(empty).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashBlob matches hashBytes for the same content', async () => {
    const raw = bytes(9, 8, 7, 6, 5);
    const blob = new Blob([raw], { type: 'image/png' });
    expect(await hashBlob(blob)).toBe(await hashBytes(raw));
  });

  it('hash ignores the blob mime type — only the bytes matter', async () => {
    const raw = bytes(42, 42, 42);
    const asPng = new Blob([raw], { type: 'image/png' });
    const asWebp = new Blob([raw], { type: 'image/webp' });
    expect(await hashBlob(asPng)).toBe(await hashBlob(asWebp));
  });

  it('a view over a larger buffer hashes only its own bytes', async () => {
    const backing = new Uint8Array([0, 0, 1, 2, 3, 0, 0]);
    const view = new Uint8Array(backing.buffer, 2, 3);
    expect(await hashBytes(view as Uint8Array<ArrayBuffer>)).toBe(await hashBytes(bytes(1, 2, 3)));
  });
});

describe('synth/images base64ToBlob', () => {
  it('round-trips bytes through base64', async () => {
    const raw = bytes(0, 1, 127, 128, 255);
    const base64 = toBase64(raw);
    const blob = base64ToBlob(base64, 'image/png');
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(raw);
  });

  it('hashes to the same value as the original file bytes', async () => {
    const raw = bytes(3, 1, 4, 1, 5, 9, 2, 6);
    const blob = base64ToBlob(toBase64(raw), 'image/webp');
    expect(await hashBlob(blob)).toBe(await hashBytes(raw));
  });
});

describe('synth/images svg detection', () => {
  it('detects SVG by mime or by extension', () => {
    expect(isSvg('image/svg+xml', 'logo.bin')).toBe(true);
    expect(isSvg('', 'logo.svg')).toBe(true);
    expect(isSvg('', 'LOGO.SVG')).toBe(true);
    expect(isSvg('image/png', 'logo.png')).toBe(false);
    expect(isSvg('', 'svg-logo.png')).toBe(false);
  });

  it('rasterizes SVG to a fixed long edge', () => {
    expect(SVG_RASTER_SIZE).toBe(2048);
  });
});
