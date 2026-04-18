import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { OllamaAdapter } from '../../src/adapters/ollama-adapter.js';
import { loadAgentFromDirectory } from '../../src/agents/loader.js';
import { auditEvidenceText } from '../../src/orchestrator/evidence-gate.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';

const RUN_LIVE = process.env['MAP_RUN_LIVE_EVIDENCE_TESTS'] === '1';
const MODEL_OVERRIDE = process.env['MAP_LLM_TEST_MODEL'];
const AGENTS_DIR = path.join(process.cwd(), 'agents');

async function runAgent(agentName: string, task: string): Promise<string> {
  const agent = await loadAgentFromDirectory(path.join(AGENTS_DIR, agentName));
  const adapter = new OllamaAdapter(MODEL_OVERRIDE ?? modelFor(agent));
  let output = '';
  for await (const chunk of adapter.run([
    agent.prompt,
    '',
    '--- Evidence smoke-test task ---',
    task,
  ].join('\n'), { think: false, hideThinking: true })) {
    output += chunk;
  }
  return output;
}

function modelFor(agent: AgentDefinition): string {
  if (!agent.model) throw new Error(`${agent.name} does not define an Ollama model`);
  return agent.model;
}

describe.skipIf(!RUN_LIVE)('live evidence ledger smoke tests', () => {
  it('usage-classification-tree emits an auditable claim evidence ledger', async () => {
    const output = await runAgent(
      'usage-classification-tree',
      'Create a concise usage classification tree for alanine. Include the Claim Evidence Ledger.',
    );

    expect(output).toContain('Claim Evidence Ledger');
    const audit = auditEvidenceText(output);
    expect(audit).not.toBeNull();
    expect(audit!.claims.length).toBeGreaterThan(0);
  }, 180_000);
});
