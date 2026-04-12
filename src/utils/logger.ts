const DEBUG = process.env['MAP_DEBUG'] === '1' || process.env['MAP_DEBUG'] === 'true';

export function debug(message: string, ...args: unknown[]): void {
  if (DEBUG) {
    console.error(`[MAP DEBUG] ${message}`, ...args);
  }
}

export function info(message: string): void {
  if (DEBUG) {
    console.error(`[MAP INFO] ${message}`);
  }
}

export function warn(message: string): void {
  console.error(`[MAP WARN] ${message}`);
}
