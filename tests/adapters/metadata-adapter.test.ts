import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { MetadataAdapter } from '../../src/adapters/metadata-adapter.js';

async function collect(adapter: MetadataAdapter, cwd: string): Promise<string> {
  let output = '';
  for await (const chunk of adapter.run('Generate metadata', { cwd })) output += chunk;
  return output;
}

describe('MetadataAdapter', () => {
  it('generates codefetch-style markdown metadata without modifying files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-metadata-'));
    await fs.writeFile(path.join(dir, 'index.ts'), 'export function hello() { return "hi"; }\n', 'utf8');
    const before = await fs.readdir(dir);

    const output = await collect(new MetadataAdapter('codefetch'), dir);

    expect(output).toContain('# CodeFetch Metadata');
    expect(output).toContain('index.ts');
    expect(output).toContain('export function hello');
    expect(await fs.readdir(dir)).toEqual(before);
  });

  it('generates insightcode and codesight variants', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-metadata-'));
    await fs.mkdir(path.join(dir, 'src'));
    await fs.writeFile(path.join(dir, 'src/app.ts'), 'import x from "./x";\nexport class App {}\n', 'utf8');

    const insight = await collect(new MetadataAdapter('insightcode'), dir);
    const codesight = await collect(new MetadataAdapter('codesight'), dir);

    expect(insight).toContain('# InsightCode Metadata');
    expect(insight).toContain('Architecture Sketch');
    expect(codesight).toContain('# CodeSight Metadata');
    expect(codesight).toContain('Imports');
  });
});
