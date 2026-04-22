import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';

interface PackageJson {
  scripts?: Record<string, string>;
}

describe('package test scripts', () => {
  it('splits stable core tests from TUI and spike suites with timeout protection', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as PackageJson;

    expect(pkg.scripts?.test).toBe('npm run test:core');
    expect(pkg.scripts?.['test:core']).toContain('vitest.core.config.ts');
    expect(pkg.scripts?.['test:tui']).toContain('scripts/run-with-timeout.mjs 60000');
    expect(pkg.scripts?.['test:tui']).toContain('vitest.tui.config.ts');
    expect(pkg.scripts?.['test:spike']).toContain('scripts/run-with-timeout.mjs 60000');
    expect(pkg.scripts?.['test:llm-agents']).toContain('scripts/run-with-timeout.mjs 900000');
    expect(pkg.scripts?.['test:ci']).toBe('npm run typecheck && npm run test:core && npm run test:tui');
    expect(pkg.scripts?.['test:all']).toBe('npm run test:ci && npm run test:spike && npm run test:llm-agents && npm run test:llm-evidence && npm run test:e2e-cocaine-report');
  });
});
