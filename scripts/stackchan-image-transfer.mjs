const DEFAULT_CHUNK_CHARACTERS = 32 * 1024;
const INTERNAL_ID_START = 0xe0000000;

function isSetImageRequest(frame) {
  return (
    frame !== null &&
    typeof frame === 'object' &&
    typeof frame.id === 'number' &&
    frame.method === 'setImage' &&
    frame.params !== null &&
    typeof frame.params === 'object' &&
    typeof frame.params.name === 'string' &&
    typeof frame.params.mime === 'string' &&
    typeof frame.params.bytesBase64 === 'string'
  );
}

function decodedByteLength(bytesBase64) {
  const isCanonicalBase64 =
    bytesBase64.length > 0 &&
    bytesBase64.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(bytesBase64);
  if (!isCanonicalBase64) return null;
  const padding = bytesBase64.endsWith('==') ? 2 : bytesBase64.endsWith('=') ? 1 : 0;
  return (bytesBase64.length / 4) * 3 - padding;
}

/**
 * setImageだけをCoreS3向けの逐次チャンク要求へ変換する。
 *
 * 1チャンクずつACKを待つことで、USB Serialの小さい受信バッファへ連続書き込みが
 * 雪崩れ込まないようにする。元のrequest idはcommit応答へ戻すので、vj-bridgeと
 * vj-ctlからは通常のsetImage 1回に見える。
 */
export function createChunkedImageTransport({
  writeLine,
  sendResponse,
  chunkCharacters = DEFAULT_CHUNK_CHARACTERS,
}) {
  const hasValidChunkSize =
    Number.isInteger(chunkCharacters) && chunkCharacters > 0 && chunkCharacters % 4 === 0;
  if (!hasValidChunkSize) {
    throw new Error('chunkCharacters must be a positive multiple of 4');
  }

  const queue = [];
  let active = null;
  let nextInternalId = INTERNAL_ID_START;
  let awaiting = null;

  const allocateId = () => {
    const id = nextInternalId;
    nextInternalId = nextInternalId === 0xffffffff ? INTERNAL_ID_START : nextInternalId + 1;
    return id;
  };

  const sendInternal = (method, params, stage) => {
    const id = allocateId();
    awaiting = { id, stage };
    writeLine(`${JSON.stringify({ id, method, params })}\n`);
  };

  const sendNext = () => {
    const hasActiveTransfer = active !== null;
    if (!hasActiveTransfer) {
      active = queue.shift() ?? null;
      const hasQueuedTransfer = active !== null;
      if (!hasQueuedTransfer) return;
      sendInternal(
        'beginImageUpload',
        { name: active.name, mime: active.mime, byteLength: active.byteLength },
        'begin',
      );
      return;
    }

    const hasRemainingChunk = active.offset < active.bytesBase64.length;
    if (hasRemainingChunk) {
      const chunk = active.bytesBase64.slice(active.offset, active.offset + chunkCharacters);
      active.offset += chunk.length;
      sendInternal('appendImageUpload', { bytesBase64: chunk }, 'append');
      return;
    }
    sendInternal('commitImageUpload', undefined, 'commit');
  };

  const finish = (response) => {
    sendResponse(JSON.stringify({ ...response, id: active.originalId }));
    active = null;
    awaiting = null;
    sendNext();
  };

  return {
    handleRequest(raw) {
      let frame;
      try {
        frame = JSON.parse(raw);
      } catch {
        writeLine(`${raw}\n`);
        return;
      }
      const uploadsImage = isSetImageRequest(frame);
      if (!uploadsImage) {
        writeLine(`${raw}\n`);
        return;
      }
      const byteLength = decodedByteLength(frame.params.bytesBase64);
      const hasValidPayload = byteLength !== null;
      if (!hasValidPayload) {
        sendResponse(
          JSON.stringify({
            id: frame.id,
            result: { ok: false, issues: ['invalid base64 payload'] },
          }),
        );
        return;
      }
      queue.push({
        originalId: frame.id,
        name: frame.params.name,
        mime: frame.params.mime,
        byteLength,
        bytesBase64: frame.params.bytesBase64,
        offset: 0,
      });
      const canStartTransfer = active === null && awaiting === null;
      if (canStartTransfer) sendNext();
    },

    handleResponse(raw) {
      let frame;
      try {
        frame = JSON.parse(raw);
      } catch {
        sendResponse(raw);
        return;
      }
      const isInternalResponse = awaiting !== null && frame?.id === awaiting.id;
      if (!isInternalResponse) {
        sendResponse(raw);
        return;
      }
      const didFail = frame.error !== undefined || frame.result?.ok === false;
      const didCommit = awaiting.stage === 'commit';
      const didFinish = didFail || didCommit;
      if (didFinish) {
        finish(frame);
        return;
      }
      awaiting = null;
      sendNext();
    },

    reset() {
      const hasInFlightTransfer = active !== null || awaiting !== null;
      if (hasInFlightTransfer) {
        const id = allocateId();
        writeLine(`${JSON.stringify({ id, method: 'cancelImageUpload' })}\n`);
      }
      queue.length = 0;
      active = null;
      awaiting = null;
    },
  };
}
