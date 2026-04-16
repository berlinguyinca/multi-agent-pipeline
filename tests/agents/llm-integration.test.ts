import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { OllamaAdapter } from '../../src/adapters/ollama-adapter.js';
import { loadAgentFromDirectory } from '../../src/agents/loader.js';
import { normalizeTerminalText } from '../../src/utils/terminal-text.js';
import { normalizeScientificNotation } from '../../src/utils/scientific-notation.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';

const MODEL_OVERRIDE = process.env['MAP_LLM_TEST_MODEL'];
const AGENTS_DIR = path.join(process.cwd(), 'agents');

async function runAgent(agentName: string, task: string): Promise<string> {
  const agent = await loadAgentFromDirectory(path.join(AGENTS_DIR, agentName));
  const adapter = new OllamaAdapter(MODEL_OVERRIDE ?? modelFor(agent));
  let output = '';
  const prompt = [
    agent.prompt,
    '',
    '--- Integration test task ---',
    task,
  ].join('\n');

  for await (const chunk of adapter.run(prompt, { think: false, hideThinking: true })) {
    output += chunk;
  }
  return output.trim();
}

function modelFor(agent: AgentDefinition): string {
  if (!agent.model) {
    throw new Error(`${agent.name} does not define an Ollama model; set MAP_LLM_TEST_MODEL`);
  }
  return agent.model;
}

function expectIncludesAll(output: string, expected: string[]): void {
  const normalized = output.toLowerCase();
  for (const item of expected) {
    expect(normalized, `Expected output to include ${item}; output was:\n${output}`).toContain(item.toLowerCase());
  }
}

describe('real LLM agent integration contracts', () => {
  it('grammar-spelling-specialist fixes grammar without changing tone or message', async () => {
    const output = await runAgent(
      'grammar-spelling-specialist',
      'Correct only spelling/grammar/punctuation. Text: I hate this API, but the timeout are 30 second and must stay exactly 30 seconds.',
    );

    expectIncludesAll(output, ['hate', 'API', 'timeout', '30 seconds']);
    expect(output.toLowerCase()).not.toContain('acceptable');
    expect(output.toLowerCase()).not.toContain('recommend');
  }, 180_000);

  it('classyfire-taxonomy-classifier produces ChemOnt taxonomy and does not claim API use', async () => {
    const output = await runAgent(
      'classyfire-taxonomy-classifier',
      'Generate the ClassyFire/ChemOnt taxonomy tree for alanine. Do not use any API. Keep formulas plain text.',
    );

    expectIncludesAll(output, ['ClassyFire', 'ChemOnt', 'Organic compounds', 'Amino acids']);
    expect(output.toLowerCase()).toContain('api');
    expect(output.toLowerCase()).not.toContain('live classyfire api was used');
    expect(output).not.toContain('\\text');
  }, 180_000);

  it('usage-classification-tree produces usage hierarchy and keeps it separate from chemical taxonomy', async () => {
    const output = await runAgent(
      'usage-classification-tree',
      'Create a usage classification tree for aspirin up to six levels when biologically or medically sensible. Do not create ClassyFire or ChemOnt taxonomy.',
    );

    expectIncludesAll(output, ['Usage Classification', 'aspirin']);
    expect(output.toLowerCase()).not.toContain('chemont');
    expect(output.toLowerCase()).not.toContain('classyfire');
    expect(output.toLowerCase()).not.toMatch(/\b(take|dose|dosage)\s+\d+/);
  }, 180_000);

  it('researcher output is normalized to plain-text chemical formulas in non-LaTeX contexts', async () => {
    const output = await runAgent(
      'researcher',
      'Briefly explain alanine and include its chemical formula. Do not use LaTeX or Markdown math.',
    );

    const normalized = normalizeScientificNotation(normalizeTerminalText(output));
    expect(normalized).toContain('C3H7NO2');
    expect(normalized).not.toContain('\\text');
    expect(normalized).not.toContain('$');
  }, 180_000);

  it('output-formatter preserves graph and final result while formatting', async () => {
    const output = await runAgent(
      'output-formatter',
      [
        'Format this result as Markdown. Preserve graph and final result exactly in meaning.',
        'Agent Graph: step-1 [researcher] -> step-2 [writer]',
        'Final Result: Alanine formula C3H7NO2.',
      ].join('\n'),
    );

    expectIncludesAll(output, ['step-1', 'researcher', 'step-2', 'writer', 'C3H7NO2']);
    expect(output).not.toContain('C_3');
    expect(output).not.toContain('\\text');
  }, 180_000);

});
