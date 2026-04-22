import { describe, expect, it, vi } from 'vitest';
import { buildRefineQuestionPrompt, generateRefineQuestions, parseRefineQuestionResponse } from '../../src/refine/question-generator.js';
import type { AgentAdapter } from '../../src/types/adapter.js';

function fakeAdapter(output: string): AgentAdapter {
  return {
    type: 'ollama',
    model: 'gemma4',
    detect: vi.fn(),
    cancel: vi.fn(),
    async *run(prompt: string, options?: Record<string, unknown>) {
      expect(prompt).toContain('Ask only questions whose answers are not already present');
      expect(options?.['responseFormat']).toBe('json');
      yield output;
    },
  };
}

describe('refine question generator', () => {
  it('builds a prompt that asks for task-specific non-generic questions', () => {
    const prompt = buildRefineQuestionPrompt({
      prompt: 'Build a PubChem sync tool',
      heuristicQuestions: ['What is the primary goal?'],
      recommendedCapabilities: [{ agent: 'codesight-metadata', reason: 'software task' }],
    });

    expect(prompt).toContain('Make questions specific to the user task');
    expect(prompt).toContain('definition of done');
    expect(prompt).toContain('Build a PubChem sync tool');
    expect(prompt).toContain('codesight-metadata');
  });

  it('parses generated PubChem-specific questions', () => {
    const questions = parseRefineQuestionResponse(JSON.stringify({
      questions: [
        {
          question: 'Which PubChem distribution source should be authoritative: FTP bulk dumps, PUG-REST, PUG-View, or another endpoint?',
          reason: 'Different sources have different rate limits and file layouts.',
          defaultAssumption: 'Prefer FTP bulk dumps for full-database sync.',
        },
      ],
    }));

    expect(questions).toEqual([
      expect.objectContaining({
        question: expect.stringContaining('PubChem distribution source'),
        reason: expect.stringContaining('rate limits'),
        defaultAssumption: expect.stringContaining('FTP bulk dumps'),
      }),
    ]);
  });

  it('generates questions through an adapter', async () => {
    const questions = await generateRefineQuestions({
      adapter: fakeAdapter(JSON.stringify({
        questions: [
          { question: 'What local mirror deletion policy should be used?', reason: 'Sync semantics affect data loss.', defaultAssumption: 'Keep versioned snapshots.' },
        ],
      })),
      prompt: 'Build a PubChem sync tool',
      heuristicQuestions: ['What is the primary goal?'],
      recommendedCapabilities: [],
    });

    expect(questions[0]?.question).toContain('mirror deletion policy');
  });
});
