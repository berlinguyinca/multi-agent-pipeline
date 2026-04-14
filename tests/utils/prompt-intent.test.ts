import { describe, it, expect } from 'vitest';
import { shouldUseResearchFlow } from '../../src/utils/prompt-intent.js';

describe('shouldUseResearchFlow', () => {
  it('routes an obvious research question to the v2 flow', () => {
    expect(
      shouldUseResearchFlow('Tell me how the chemical alanine is used in metabolomics research'),
    ).toBe(true);
  });

  it('routes explanatory prompts to the v2 flow', () => {
    expect(shouldUseResearchFlow('Explain alanine use in metabolomics')).toBe(true);
  });

  it('keeps build prompts on the classic pipeline', () => {
    expect(shouldUseResearchFlow('Build a TypeScript CLI that parses CSV files')).toBe(false);
  });

  it('keeps mixed build-and-question prompts on the classic pipeline', () => {
    expect(shouldUseResearchFlow('Tell me how to build a TypeScript CLI')).toBe(false);
  });

  it('does not override an explicit GitHub issue flow', () => {
    expect(
      shouldUseResearchFlow(
        'Tell me how alanine is used in metabolomics',
        'https://github.com/org/repo/issues/1',
      ),
    ).toBe(false);
  });
});
