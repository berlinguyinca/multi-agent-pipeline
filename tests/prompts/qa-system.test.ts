import { describe, expect, it } from 'vitest';
import {
  buildCodeFixPrompt,
  buildCodeQaPrompt,
  buildSpecQaPrompt,
} from '../../src/prompts/qa-system.js';

describe('buildSpecQaPrompt', () => {
  it('includes original request, reviewed spec, and required QA marker', () => {
    const prompt = buildSpecQaPrompt('Build a CLI', '# Reviewed Spec');

    expect(prompt).toContain('Build a CLI');
    expect(prompt).toContain('# Reviewed Spec');
    expect(prompt).toContain('QA_RESULT: pass|fail');
  });
});

describe('buildCodeQaPrompt', () => {
  it('includes spec, execution summary, project snapshot, and QA marker', () => {
    const prompt = buildCodeQaPrompt(
      '# Spec',
      {
        success: true,
        testsTotal: 1,
        testsPassing: 1,
        testsFailing: 0,
        filesCreated: ['src/index.ts'],
        outputDir: './output/demo',
        duration: 100,
      },
      '--- src/index.ts ---\nexport {};\n',
    );

    expect(prompt).toContain('# Spec');
    expect(prompt).toContain('src/index.ts');
    expect(prompt).toContain('QA_RESULT: pass|fail');
  });
});

describe('buildCodeFixPrompt', () => {
  it('includes approved spec and QA findings', () => {
    const prompt = buildCodeFixPrompt('# Spec', 'REQUIRED_CHANGE: Add tests', './output/demo');

    expect(prompt).toContain('# Spec');
    expect(prompt).toContain('REQUIRED_CHANGE: Add tests');
    expect(prompt).toContain('current working directory only');
  });
});
