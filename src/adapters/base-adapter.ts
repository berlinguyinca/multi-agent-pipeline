import { spawn, type ChildProcess } from 'node:child_process';
import { platform } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AdapterType, DetectInfo, RunOptions } from '../types/adapter.js';

const execFileAsync = promisify(execFile);

export class AdapterError extends Error {
  constructor(
    message: string,
    public readonly adapterType: AdapterType,
    public readonly exitCode?: number,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

export abstract class BaseAdapter implements AgentAdapter {
  abstract readonly type: AdapterType;
  abstract readonly model: string | undefined;

  protected currentProcess: ChildProcess | null = null;

  abstract detect(): Promise<DetectInfo>;
  abstract run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void>;

  cancel(): void {
    if (!this.currentProcess) return;

    if (platform() === 'win32') {
      spawn('taskkill', ['/pid', String(this.currentProcess.pid), '/f', '/t']);
    } else {
      this.currentProcess.kill('SIGTERM');
      setTimeout(() => {
        if (this.currentProcess && !this.currentProcess.killed) {
          this.currentProcess.kill('SIGKILL');
        }
      }, 3000);
    }
  }

  protected async detectBinary(binary: string): Promise<DetectInfo> {
    const cmd = platform() === 'win32' ? 'where' : 'which';
    try {
      const { stdout } = await execFileAsync(cmd, [binary]);
      const binaryPath = stdout.trim().split('\n')[0];
      return { installed: true, binaryPath };
    } catch {
      return { installed: false };
    }
  }

  protected async *streamProcess(
    binary: string,
    args: string[],
    options?: { signal?: AbortSignal; cwd?: string; env?: Record<string, string> },
  ): AsyncGenerator<string, void, void> {
    const child = spawn(binary, args, {
      cwd: options?.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...options?.env },
    });

    this.currentProcess = child;
    let stderr = '';

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const abortHandler = () => {
      this.cancel();
    };

    if (options?.signal) {
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
      const stdoutIterator = child.stdout;
      if (!stdoutIterator) {
        throw new AdapterError('No stdout stream', this.type);
      }

      for await (const data of stdoutIterator) {
        if (options?.signal?.aborted) {
          return;
        }
        yield (data as Buffer).toString();
      }

      const exitCode = await new Promise<number | null>((resolve) => {
        child.on('close', resolve);
      });

      if (exitCode !== null && exitCode !== 0) {
        throw new AdapterError(
          `${binary} exited with code ${exitCode}: ${stderr}`,
          this.type,
          exitCode,
          stderr,
        );
      }
    } finally {
      options?.signal?.removeEventListener('abort', abortHandler);
      this.currentProcess = null;
    }
  }
}
