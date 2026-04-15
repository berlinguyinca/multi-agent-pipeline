import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { loadAgentFromDirectory } from '../../src/agents/loader.js';
import { loadAgentRegistry } from '../../src/agents/registry.js';
import { buildRouterPrompt } from '../../src/router/prompt-builder.js';
import { validateDAGPlan, type DAGPlan } from '../../src/types/dag.js';

const AGENTS_DIR = path.join(process.cwd(), 'agents');

const SOFTWARE_DELIVERY_AGENTS = [
  'software-delivery',
  'spec-writer',
  'spec-qa-reviewer',
  'tdd-engineer',
  'implementation-coder',
  'code-qa-analyst',
  'github-review-merge-specialist',
  'bug-debugger',
  'build-fixer',
  'test-stabilizer',
  'refactor-cleaner',
  'docs-maintainer',
  'release-readiness-reviewer',
  'presentation-designer',
  'visualization-builder',
] as const;

describe('software delivery agent bundle', () => {
  it('loads every software delivery agent from the registry', async () => {
    const agents = await loadAgentRegistry(AGENTS_DIR);

    for (const name of SOFTWARE_DELIVERY_AGENTS) {
      expect(agents.has(name)).toBe(true);
    }
  });

  it('uses ollama gemma4:26b for every new agent', async () => {
    for (const name of SOFTWARE_DELIVERY_AGENTS) {
      const agent = await loadAgentFromDirectory(path.join(AGENTS_DIR, name));

      expect(agent.adapter).toBe('ollama');
      expect(agent.model).toBe('gemma4:26b');
    }
  });

  it('references only prompt files that exist', async () => {
    for (const name of SOFTWARE_DELIVERY_AGENTS) {
      const agentDir = path.join(AGENTS_DIR, name);
      const yaml = parseYaml(await fs.readFile(path.join(agentDir, 'agent.yaml'), 'utf-8')) as {
        prompt: string;
        pipeline: Array<string | { prompt?: string }>;
      };

      await expect(fs.access(path.join(agentDir, yaml.prompt))).resolves.toBeUndefined();

      for (const stage of yaml.pipeline) {
        if (typeof stage === 'object' && stage.prompt) {
          await expect(fs.access(path.join(agentDir, stage.prompt))).resolves.toBeUndefined();
        }
      }
    }
  });

  it('exposes the new agents to the router prompt', async () => {
    const agents = await loadAgentRegistry(AGENTS_DIR);
    const prompt = buildRouterPrompt(agents, 'Build a feature with TDD and QA review');

    expect(prompt).toContain('spec-writer');
    expect(prompt).toContain('implementation-coder');
    expect(prompt).toContain('github-review-merge-specialist');
    expect(prompt).toContain('test-driven development');
    expect(prompt).toContain('release-readiness-reviewer');
  });

  it('validates the documented feature delivery DAG', () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'spec-writer', task: 'Create an implementation-ready specification', dependsOn: [] },
        { id: 'step-2', agent: 'spec-qa-reviewer', task: 'Review the specification', dependsOn: ['step-1'] },
        { id: 'step-3', agent: 'tdd-engineer', task: 'Write failing tests', dependsOn: ['step-2'] },
        { id: 'step-4', agent: 'implementation-coder', task: 'Implement the behavior', dependsOn: ['step-3'] },
        { id: 'step-5', agent: 'code-qa-analyst', task: 'Review the implementation', dependsOn: ['step-4'] },
        { id: 'step-6', agent: 'docs-maintainer', task: 'Update Markdown docs', dependsOn: ['step-5'] },
        { id: 'step-7', agent: 'release-readiness-reviewer', task: 'Assess readiness', dependsOn: ['step-6'] },
        { id: 'step-8', agent: 'github-review-merge-specialist', task: 'Perform the final GitHub PR review and merge the approved changes', dependsOn: ['step-7'] },
      ],
    };

    expect(validateDAGPlan(plan)).toEqual({ valid: true });
  });
});
