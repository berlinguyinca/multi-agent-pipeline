#!/usr/bin/env node
import { spawn } from 'node:child_process';

const [, , timeoutMsRaw, ...command] = process.argv;
const timeoutMs = Number(timeoutMsRaw);

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || command.length === 0) {
  console.error('Usage: node scripts/run-with-timeout.mjs <timeout-ms> <command> [...args]');
  process.exit(2);
}

const child = spawn(command[0], command.slice(1), {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

let finished = false;
const timer = setTimeout(() => {
  if (finished) return;
  child.kill('SIGTERM');
  setTimeout(() => {
    if (!finished) child.kill('SIGKILL');
  }, 3_000).unref();
}, timeoutMs);

timer.unref();

child.on('exit', (code, signal) => {
  finished = true;
  clearTimeout(timer);
  if (signal) {
    console.error(`Command timed out or was terminated by ${signal}`);
    process.exit(124);
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  finished = true;
  clearTimeout(timer);
  console.error(error.message);
  process.exit(127);
});
