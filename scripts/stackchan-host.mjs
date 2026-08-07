#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WebSocket } from 'ws';

const DEFAULT_PORT = 7877;
const RECONNECT_DELAY_MS = 250;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseOptions(argv) {
  let port = DEFAULT_PORT;
  let headless = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const enablesHeadless = argument === '--headless';
    if (enablesHeadless) {
      headless = true;
      continue;
    }
    const setsPort = argument === '--port';
    if (setsPort) {
      const value = Number(argv[++index]);
      const isValidPort = Number.isInteger(value) && value > 0 && value <= 65535;
      if (!isValidPort) {
        throw new Error(`invalid --port: ${argv[index]}`);
      }
      port = value;
      continue;
    }
    throw new Error(`unknown option: ${argument}`);
  }
  return { port, headless };
}

function lines(stream, onLine) {
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

function connectSynth(port, simulator, isStopping, onSocket) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  onSocket(socket);
  socket.on('open', () => {
    socket.send(JSON.stringify({ hello: 'synth' }));
    console.log(`[stackchan-host] simulator connected on port ${port}`);
  });
  socket.on('message', (data) => {
    const simulatorAcceptsInput = simulator.stdin.writable;
    if (simulatorAcceptsInput) {
      simulator.stdin.write(`${data.toString()}\n`);
    }
  });
  socket.on('close', () => {
    const shouldReconnect = !isStopping();
    if (shouldReconnect) {
      setTimeout(() => connectSynth(port, simulator, isStopping, onSocket), RECONNECT_DELAY_MS);
    }
  });
  socket.on('error', () => {});
  return socket;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const bridge = spawn(
    process.execPath,
    ['scripts/vj-bridge.mjs', '--port', String(options.port)],
    {
      cwd: root,
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  const simulatorEnvironment = options.headless
    ? { ...process.env, SDL_VIDEODRIVER: 'dummy' }
    : process.env;
  const simulator = spawn(resolve(root, 'build/host/stackchan-simulator'), ['--control-stdio'], {
    cwd: root,
    env: simulatorEnvironment,
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  let stopping = false;
  let socket = null;
  connectSynth(
    options.port,
    simulator,
    () => stopping,
    (connected) => {
      socket = connected;
    },
  );
  lines(simulator.stdout, (line) => {
    const canForward = socket?.readyState === WebSocket.OPEN;
    if (canForward) {
      socket.send(line);
    }
  });

  const stop = () => {
    const alreadyStopping = stopping;
    if (alreadyStopping) return;
    stopping = true;
    socket?.close();
    simulator.stdin.end();
    simulator.kill('SIGTERM');
    bridge.kill('SIGTERM');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  simulator.on('exit', (code) => {
    const failed = !stopping && code !== 0;
    if (failed) process.exitCode = code ?? 1;
    stop();
  });
  bridge.on('exit', (code) => {
    const failed = !stopping && code !== 0;
    if (failed) process.exitCode = code ?? 1;
    stop();
  });
}

main().catch((error) => {
  console.error(`stackchan-host: ${error.message}`);
  process.exitCode = 1;
});
