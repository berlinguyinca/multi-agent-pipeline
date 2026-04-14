import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BaseAdapter } from '../../src/adapters/base-adapter.js';
import type { DetectInfo, RunOptions } from '../../src/types/adapter.js';

class ScriptAdapter extends BaseAdapter {
  readonly type = 'codex' as const;
  readonly model = undefined;

  async detect(): Promise<DetectInfo> {
    return { installed: true };
  }

  async *run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
    yield* this.streamProcess(process.execPath, ['-e', prompt], {
      cwd: options?.cwd,
      signal: options?.signal,
    });
  }
}

describe('BaseAdapter', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('closes child stdin so commands waiting for EOF can complete', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-base-adapter-'));
    tempDirs.push(tmpDir);

    const script = `
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  process.stdout.write(input === '' ? 'stdin-closed' : input);
});
`;

    const adapter = new ScriptAdapter();
    const chunks: string[] = [];
    for await (const chunk of adapter.run(script, { cwd: tmpDir })) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe('stdin-closed');
  });
});
