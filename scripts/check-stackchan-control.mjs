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

const catalog = byId.get(8)?.result;
const hasCatalog =
  Array.isArray(catalog) &&
  catalog.length === 105 &&
  catalog.some((definition) => definition.id === 'grid') &&
  catalog.some((definition) => definition.id === 'stamp' && definition.textures?.includes('image'));
if (!hasCatalog) {
  throw new Error('generator catalog is incomplete');
}

const derivedState = byId.get(10)?.result;
const hasDerivedPatch =
  derivedState?.seed === 'portable-neon-042' &&
  derivedState?.currentPatch?.seed === 'portable-neon-042' &&
  Array.isArray(derivedState.currentPatch.operators) &&
  derivedState.currentPatch.operators.length >= 3;
if (!hasDerivedPatch) {
  throw new Error('proposeSeed did not derive a semantic patch');
}

const imageResult = byId.get(15)?.result;
const hasImage =
  imageResult?.ok === true &&
  imageResult.name === 'pixel.png' &&
  imageResult.hash === '431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460';
if (!hasImage) {
  throw new Error('setImage did not store the SHA-256 addressed image');
}
const imagePatch = byId.get(17)?.result?.currentPatch;
if (imagePatch?.images?.['src0.image']?.hash !== imageResult.hash) {
  throw new Error('image Patch was not applied');
}

const settingsResult = byId.get(19)?.result?.settings;
const hasSanitizedSettings =
  settingsResult?.gain === 4 &&
  settingsResult?.hueMode === 'fixed' &&
  settingsResult?.fixedHue === 360 &&
  settingsResult?.background === 'transparent' &&
  settingsResult?.cycleMode === 'bars' &&
  settingsResult?.cycleBars === 256 &&
  settingsResult?.gachaBars === 1;
if (!hasSanitizedSettings) {
  throw new Error('setSettings did not apply and sanitize the CoreS3 settings');
}

const jpegResult = byId.get(20)?.result;
const hasJpeg =
  jpegResult?.ok === true &&
  jpegResult.name === 'pixel.jpg' &&
  jpegResult.hash === 'c158ec5886006afa0f5122e5c9e7aa8e0433aed6b74fa818d87b438e6652abf0';
const hasAppliedJpeg = byId.get(21)?.result?.ok === true;
const hasWorkingJpegPatch = hasJpeg && hasAppliedJpeg;
if (!hasWorkingJpegPatch) {
  throw new Error('JPEG image was not decoded and applied');
}
