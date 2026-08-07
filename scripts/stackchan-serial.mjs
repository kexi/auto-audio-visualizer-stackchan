#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, createReadStream, openSync, writeSync } from 'node:fs';
import { WebSocket } from 'ws';

const DEFAULT_PORT = 7877;
const RECONNECT_DELAY_MS = 250;

function parseOptions(argv) {
  let device = '';
  let port = DEFAULT_PORT;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const setsDevice = argument === '--device';
    const setsPort = argument === '--port';
    if (setsDevice) {
      device = argv[++index] ?? '';
      continue;
    }
    if (setsPort) {
      const value = Number(argv[++index]);
      const isValidPort = Number.isInteger(value) && value > 0 && value <= 65535;
      if (!isValidPort) throw new Error(`invalid --port: ${argv[index]}`);
      port = value;
      continue;
    }
    throw new Error(`unknown option: ${argument}`);
  }
  const hasDevice = device.length > 0;
  if (!hasDevice) throw new Error('--device is required');
  return { device, port };
}

function configureSerial(device) {
  const deviceFlag = process.platform === 'darwin' ? '-f' : '-F';
  const configured = spawnSync(
    'stty',
    [deviceFlag, device, '115200', 'raw', '-echo', '-ixon', '-ixoff'],
    { encoding: 'utf8' },
  );
  const didConfigure = configured.status === 0;
  if (!didConfigure) {
    throw new Error(`stty failed: ${configured.stderr.trim() || `exit ${configured.status}`}`);
  }
}

function forwardLines(stream, onLine) {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    pending += chunk;
    for (;;) {
      const newline = pending.indexOf('\n');
      const hasLine = newline >= 0;
      if (!hasLine) return;
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      const hasText = line.length > 0;
      if (hasText) onLine(line);
    }
  });
}

function connectSynth(port, writeRequest, isStopping, onSocket) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  onSocket(socket);
  socket.on('open', () => {
    socket.send(JSON.stringify({ hello: 'synth' }));
    console.log(`[stackchan-serial] CoreS3 connected to vj-ctl on port ${port}`);
  });
  socket.on('message', (data) => writeRequest(`${data.toString()}\n`));
  socket.on('close', () => {
    const shouldReconnect = !isStopping();
    if (shouldReconnect) {
      setTimeout(() => connectSynth(port, writeRequest, isStopping, onSocket), RECONNECT_DELAY_MS);
    }
  });
  socket.on('error', () => {});
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  configureSerial(options.device);
  const serialDescriptor = openSync(options.device, 'r+');
  const serialInput = createReadStream(null, { fd: serialDescriptor, autoClose: false });
  const bridge = spawn(
    process.execPath,
    ['scripts/vj-bridge.mjs', '--port', String(options.port)],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );

  let stopping = false;
  let socket = null;
  const writeRequest = (line) => writeSync(serialDescriptor, line);
  connectSynth(
    options.port,
    writeRequest,
    () => stopping,
    (connected) => {
      socket = connected;
    },
  );
  forwardLines(serialInput, (line) => {
    const canForward = socket?.readyState === WebSocket.OPEN;
    if (canForward) socket.send(line);
  });

  const stop = () => {
    const alreadyStopping = stopping;
    if (alreadyStopping) return;
    stopping = true;
    socket?.close();
    serialInput.destroy();
    closeSync(serialDescriptor);
    bridge.kill('SIGTERM');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  serialInput.on('error', (error) => {
    console.error(`stackchan-serial: ${error.message}`);
    process.exitCode = 1;
    stop();
  });
  bridge.on('exit', (code) => {
    const failed = !stopping && code !== 0;
    if (failed) process.exitCode = code ?? 1;
    stop();
  });
}

try {
  main();
} catch (error) {
  console.error(`stackchan-serial: ${error.message}`);
  process.exitCode = 1;
}
