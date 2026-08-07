#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const path = process.argv[2];
const hasPath = typeof path === 'string' && path.length > 0;
if (!hasPath) {
  throw new Error('response JSONL path is required');
}

const responses = readFileSync(path, 'utf8')
  .split('\n')
  .filter((line) => line.length > 0)
  .map((line) => JSON.parse(line));
const byId = new Map(responses.map((response) => [response.id, response]));
const state = byId.get(4)?.result;
const hasTimelineResult =
  state?.seed === 'timeline-seed' &&
  Array.isArray(state.firedIds) &&
  state.firedIds.includes('host-drop');
if (!hasTimelineResult) {
  throw new Error('Timeline control response is incomplete');
}

const recordingText = byId.get(7)?.result?.json;
const hasRecording = typeof recordingText === 'string';
if (!hasRecording) {
  throw new Error('stopRecording did not return JSON');
}
const recording = JSON.parse(recordingText);
const hasRecordingShape =
  recording.schemaVersion === 1 &&
  recording.engineVersion === 'stackchan-core-1' &&
  Array.isArray(recording.ops) &&
  recording.ops.some((entry) => entry.op?.op === 'setLockedUntil') &&
  Array.isArray(recording.fired);
if (!hasRecordingShape) {
  throw new Error('recording JSON is incomplete');
}
