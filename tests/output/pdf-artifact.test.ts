import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { writePdfArtifact } from '../../src/output/pdf-artifact.js';

describe('writePdfArtifact', () => {
  it('writes print-ready HTML even when PDF rendering is unavailable', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-pdf-artifact-'));
    const result = await writePdfArtifact(
      {
        version: 2,
        success: true,
        outputDir,
        dag: {
          nodes: [{ id: 'step-1', agent: 'writer', status: 'completed', duration: 1 }],
          edges: [],
        },
        steps: [{ id: 'step-1', agent: 'writer', task: 'Write', status: 'completed', output: 'Final answer' }],
      },
      { outputDir, renderPdf: false },
    );

    expect(result.htmlPath).toMatch(/map-result-.*\.html$/);
    const html = await fs.readFile(result.htmlPath, 'utf8');
    expect(html).toContain('Final answer');
    expect(html).toContain('@page');
    expect(html).toContain('Agent Network');
    expect(html).toContain('agent-flow');
    expect(html).toContain('rendered-markdown');
  });
});
