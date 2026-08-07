import { describe, expect, it } from 'vitest';
import { createChunkedImageTransport } from './stackchan-image-transfer.mjs';

describe('CoreS3 chunked image transport', () => {
  it('turns one setImage request into acknowledged begin, chunks, and commit requests', () => {
    // 1行上限を超える画像でも、元のidを保ったsetImage応答が1件だけ返ることを保証する。
    const writes = [];
    const responses = [];
    const transport = createChunkedImageTransport({
      writeLine: (line) => writes.push(JSON.parse(line)),
      sendResponse: (line) => responses.push(JSON.parse(line)),
      chunkCharacters: 8,
    });
    transport.handleRequest(
      JSON.stringify({
        id: 42,
        method: 'setImage',
        params: { name: 'pixel.png', mime: 'image/png', bytesBase64: 'QUJDREVGR0hJSg==' },
      }),
    );

    expect(writes[0]).toMatchObject({
      method: 'beginImageUpload',
      params: { name: 'pixel.png', mime: 'image/png', byteLength: 10 },
    });
    transport.handleResponse(JSON.stringify({ id: writes[0].id, result: { ok: true } }));
    expect(writes[1]).toMatchObject({
      method: 'appendImageUpload',
      params: { bytesBase64: 'QUJDREVG' },
    });
    transport.handleResponse(JSON.stringify({ id: writes[1].id, result: { ok: true } }));
    expect(writes[2]).toMatchObject({
      method: 'appendImageUpload',
      params: { bytesBase64: 'R0hJSg==' },
    });
    transport.handleResponse(JSON.stringify({ id: writes[2].id, result: { ok: true } }));
    expect(writes[3]).toMatchObject({ method: 'commitImageUpload' });
    transport.handleResponse(
      JSON.stringify({ id: writes[3].id, result: { ok: true, hash: 'abc', name: 'pixel.png' } }),
    );

    expect(responses).toEqual([{ id: 42, result: { ok: true, hash: 'abc', name: 'pixel.png' } }]);
  });

  it('forwards ordinary requests and responses unchanged', () => {
    // 画像以外の既存Bridgeプロトコルへチャンク処理が干渉しないことを保証する。
    const writes = [];
    const responses = [];
    const transport = createChunkedImageTransport({
      writeLine: (line) => writes.push(line),
      sendResponse: (line) => responses.push(line),
    });
    transport.handleRequest('{"id":1,"method":"getState"}');
    transport.handleResponse('{"id":1,"result":{"ok":true}}');
    expect(writes).toEqual(['{"id":1,"method":"getState"}\n']);
    expect(responses).toEqual(['{"id":1,"result":{"ok":true}}']);
  });

  it('returns a mapped failure and does not send later chunks', () => {
    // CoreS3がbeginを拒否した場合に内部idを漏らさず、転送を即座に止めることを保証する。
    const writes = [];
    const responses = [];
    const transport = createChunkedImageTransport({
      writeLine: (line) => writes.push(JSON.parse(line)),
      sendResponse: (line) => responses.push(JSON.parse(line)),
    });
    transport.handleRequest(
      '{"id":9,"method":"setImage","params":{"name":"x","mime":"image/png","bytesBase64":"QUJD"}}',
    );
    transport.handleResponse(
      JSON.stringify({ id: writes[0].id, result: { ok: false, issues: ['too large'] } }),
    );
    expect(writes).toHaveLength(1);
    expect(responses).toEqual([{ id: 9, result: { ok: false, issues: ['too large'] } }]);
  });

  it('cancels the device-side upload when reset interrupts a transfer', () => {
    // Bridge終了後もCoreS3に転送中状態を残さず、次回接続で画像転送を再開できることを保証する。
    const writes = [];
    const transport = createChunkedImageTransport({
      writeLine: (line) => writes.push(JSON.parse(line)),
      sendResponse: () => {},
    });
    transport.handleRequest(
      '{"id":10,"method":"setImage","params":{"name":"x","mime":"image/png","bytesBase64":"QUJD"}}',
    );
    transport.reset();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ method: 'cancelImageUpload' });
  });
});
