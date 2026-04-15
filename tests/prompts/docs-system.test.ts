import { describe, expect, it } from 'vitest';
import { buildDocsPrompt } from '../../src/prompts/docs-system.js';

describe('buildDocsPrompt', () => {
  it('instructs the agent to update Markdown documentation only', () => {
    const prompt = buildDocsPrompt({
      reviewedSpecContent: '# Spec\n\n## Goal\nBuild it',
      executionResult: {
        success: true,
        testsTotal: 1,
        testsPassing: 1,
        testsFailing: 0,
        filesCreated: ['package.json', 'src/index.ts'],
        outputDir: './output/demo',
        duration: 100,
      },
      qaAssessments: [
        {
          passed: true,
          target: 'code',
          summary: 'Code is ready',
          findings: [],
          requiredChanges: [],
          rawOutput: 'QA_RESULT: pass',
          duration: 50,
        },
      ],
      projectSnapshot: '--- package.json ---\n{"name":"demo"}',
    });

    expect(prompt).toContain('Modify Markdown files only');
    expect(prompt).toContain('README.md');
    expect(prompt).toContain('module-level README.md files');
    expect(prompt).toContain('actual implemented behavior');
    expect(prompt).toContain('package.json, src/index.ts');
    expect(prompt).toContain('Code QA: passed: Code is ready');
  });
});
