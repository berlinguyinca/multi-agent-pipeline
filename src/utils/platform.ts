import { platform } from 'node:os';

export function isWindows(): boolean {
  return platform() === 'win32';
}

export function whichCommand(): string {
  return isWindows() ? 'where' : 'which';
}

export function killSignal(): NodeJS.Signals {
  return 'SIGTERM';
}

export function forceKillSignal(): NodeJS.Signals {
  return 'SIGKILL';
}
