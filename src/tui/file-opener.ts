import { execFileSync } from 'node:child_process';

export function openFile(path: string): boolean {
  try {
    switch (process.platform) {
      case 'darwin':
        execFileSync('open', [path], { stdio: 'ignore' });
        return true;
      case 'linux':
        execFileSync('xdg-open', [path], { stdio: 'ignore' });
        return true;
      case 'win32':
        execFileSync('cmd', ['/c', 'start', '', path], { stdio: 'ignore' });
        return true;
      default:
        return false;
    }
  } catch {
    return false;
  }
}
