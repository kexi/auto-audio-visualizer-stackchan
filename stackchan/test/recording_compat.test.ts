import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRecording } from '../../src/synth/recording';

const responsePath = 'build/host/control-responses.jsonl';

describe.skipIf(!existsSync(responsePath))('Stack-chan recording compatibility', () => {
  it('accepts the C++ recording with the browser recording schema', () => {
    const responses = readFileSync(responsePath, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { id: number; result?: { json?: string } });
    const recordingText = responses.find((response) => response.id === 7)?.result?.json;
    expect(typeof recordingText).toBe('string');
    const recording = JSON.parse(recordingText!) as unknown;
    const parsed = parseRecording(recording);
    expect(parsed).toMatchObject({ ok: true });
  });
});
