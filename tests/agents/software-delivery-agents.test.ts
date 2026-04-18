import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
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
  'adviser',
  'tdd-engineer',
  'implementation-coder',
  'code-qa-analyst',
  'grammar-spelling-specialist',
  'output-formatter',
  'usage-classification-tree',
  'usage-classification-fact-checker',
  'research-fact-checker',
  'classyfire-taxonomy-classifier',
  'github-review-merge-specialist',
  'bug-debugger',
  'build-fixer',
  'test-stabilizer',
  'refactor-cleaner',
  'docs-maintainer',
  'stabilization-reviewer',
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
      if (name === 'usage-classification-fact-checker' || name === 'research-fact-checker') {
        expect(agent.model).toBe('bespoke-minicheck:7b');
      } else {
        expect(agent.model).toBe('gemma4:26b');
      }
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

  it('requires every first-party agent to define a structured contract', async () => {
    const entries = await fs.readdir(AGENTS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const agentDir = path.join(AGENTS_DIR, entry.name);
      const yaml = parseYaml(await fs.readFile(path.join(agentDir, 'agent.yaml'), 'utf-8')) as {
        contract?: unknown;
      };

      expect(yaml.contract, `${entry.name} is missing contract metadata`).toBeDefined();
    }
  });

  it('keeps every first-party agent definition visible to git', async () => {
    const entries = await fs.readdir(AGENTS_DIR, { withFileTypes: true });
    const definitionFiles = entries
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => [
        path.join('agents', entry.name, 'agent.yaml'),
        path.join('agents', entry.name, 'prompt.md'),
      ]);

    try {
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      return;
    }

    try {
      const ignored = execFileSync('git', ['check-ignore', '--', ...definitionFiles], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(ignored.trim(), `Agent definition files must not be ignored:\n${ignored}`).toBe('');
    } catch (error) {
      if (isExitCode(error, 1)) return;
      throw error;
    }
  });

  it('loads every first-party agent with professional no-emoji conduct rules', async () => {
    const entries = await fs.readdir(AGENTS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const agent = await loadAgentFromDirectory(path.join(AGENTS_DIR, entry.name));

      expect(agent.prompt, `${entry.name} is missing no-emoji guidance`).toContain(
        'Do not use emoji, pictographs, decorative symbols, or playful reaction markers.',
      );
      expect(agent.prompt, `${entry.name} is missing professional conduct guidance`).toContain(
        'Use a professional engineering tone: direct, factual, and free of cheerleading.',
      );
      expect(agent.prompt, `${entry.name} is missing human-readable output guidance`).toContain(
        'Generate code and text output in a human-readable form.',
      );
      expect(agent.prompt, `${entry.name} is missing binary/media exception guidance`).toContain(
        'Exceptions are allowed only for explicitly requested binary or media artifacts',
      );
    }
  });




  it('locks output-formatter to non-lossy rendering for any target format', async () => {
    const agent = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'output-formatter'));

    expect(agent.prompt).toContain('You are a renderer, not a summarizer');
    expect(agent.prompt).toContain('Preserve every substantive detail');
    expect(agent.prompt).toContain('If the requested presentation format cannot hold all content cleanly');
    expect(agent.contract?.mission).toContain('without dropping substantive content');
  });

  it('instructs researcher to use plain-text chemistry formulas unless LaTeX is requested', async () => {
    const agent = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'researcher'));

    expect(agent.prompt).toContain('Use plain-text chemical formulas by default');
    expect(agent.prompt).toContain('Never write chemical formulas using LaTeX');
  });


  it('loads classification agents with source-specific guardrails', async () => {
    const classyfire = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'classyfire-taxonomy-classifier'));
    const usage = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'usage-classification-tree'));

    expect(classyfire.prompt).toContain('Never call, depend on, or suggest using the ClassyFire API');
    expect(classyfire.prompt).toContain('ClassyFire / ChemOnt');
    expect(classyfire.prompt).toContain('chemical ontology classification, not biological taxonomy');
    expect(usage.prompt).toContain('what the entity is used for, not what its chemical taxonomy is');
    expect(usage.prompt).toContain('Six levels is the maximum');
    expect(usage.prompt).toContain('Do not output ClassyFire/ChemOnt hierarchy here');
  });

  it('requires the usage classifier to produce LCB-ready exposure origin summaries', async () => {
    const usage = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'usage-classification-tree'));

    expect(usage.prompt).toContain('LCB Exposure Summary');
    expect(usage.prompt).toContain('drug / drug metabolite');
    expect(usage.prompt).toContain('food compound / food metabolite');
    expect(usage.prompt).toContain('household chemical');
    expect(usage.prompt).toContain('industrial chemical');
    expect(usage.prompt).toContain('pesticide');
    expect(usage.prompt).toContain('personal care products');
    expect(usage.prompt).toContain('other exposure origins');
    expect(usage.prompt).toContain('cellular endogenous compound');
    expect(usage.prompt).toContain('three most typical diseases');
    expect(usage.prompt).toContain('three most typical foods');
    expect(usage.prompt).toContain('three most typical species');
    expect(usage.prompt).toContain('three most typical organs');
    expect(usage.prompt).toContain('For common well-known endogenous compounds');
    expect(usage.prompt).toContain('Keep the report concise and XLS-friendly');
    expect(usage.contract?.capabilities).toContain(
      'Produce LCB-ready yes/no exposure-origin categories with up to three typical diseases, foods, use areas, species, and organs as applicable.',
    );
    expect(usage.contract?.handoff.includes).toContain('LCB exposure summary');
  });

  it('loads fact-checking agents on a separate minicheck model', async () => {
    const usageFact = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'usage-classification-fact-checker'));
    const researchFact = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'research-fact-checker'));

    for (const agent of [usageFact, researchFact]) {
      expect(agent.adapter).toBe('ollama');
      expect(agent.model).toBe('bespoke-minicheck:7b');
      expect(agent.prompt).toContain('Fact-check verdict: <supported | rejected | needs-review>');
      expect(agent.contract?.handoff.includes).toContain('Fact-check verdict');
      expect(agent.contract?.nonGoals.join(' ')).toContain('format');
    }
  });

  it('requires the usage classifier to score and rank commonness without becoming a formatter', async () => {
    const usage = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'usage-classification-tree'));

    expect(usage.prompt).toContain('Usage Commonness Ranking');
    expect(usage.prompt).toContain('Commonness score');
    expect(usage.prompt).toContain('very common | common | less common | rare | unavailable');
    expect(usage.prompt).toContain('If the user requests top N');
    expect(usage.prompt).toContain('sort ranking rows by Commonness score descending');
    expect(usage.prompt).toContain('Do not act as a report formatter');
    expect(usage.contract?.capabilities).toContain(
      'Score and rank usage applications or exposure origins by evidence-backed commonness, with optional top-N truncation when requested.',
    );
    expect(usage.contract?.nonGoals).toContain(
      'Do not perform downstream report formatting, polishing, or custom presentation transformations.',
    );
    expect(usage.contract?.handoff.includes).toContain('Commonness ranking and score');
  });

  it('requires usage commonness scores to account for current prevalence and recency', async () => {
    const usage = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'usage-classification-tree'));
    const usageFact = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'usage-classification-fact-checker'));

    expect(usage.prompt).toContain('current prevalence');
    expect(usage.prompt).toContain('Recency/currentness');
    expect(usage.prompt).toContain('historical or obsolete practices');
    expect(usage.prompt).toContain('hundreds of years ago');
    expect(usage.prompt).toContain('Commonness timeframe');
    expect(usage.prompt).toContain('Recency/currentness evidence');
    expect(usage.contract?.capabilities).toContain(
      'Score and rank usage applications or exposure origins by current evidence-backed commonness, explicitly down-weighting historical, obsolete, discontinued, or regionally rare practices.',
    );
    expect(usage.contract?.verification.requiredEvidence).toContain(
      'Commonness scores account for current prevalence and recency/currentness evidence, not just historical existence.',
    );

    expect(usageFact.prompt).toContain('current prevalence');
    expect(usageFact.prompt).toContain('historical or obsolete');
    expect(usageFact.prompt).toContain('reject high commonness scores');
  });

  it('locks grammar-spelling-specialist to correction only without tone or message changes', async () => {
    const agent = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'grammar-spelling-specialist'));

    expect(agent.prompt).toContain('without changing the message, tone, voice, intent, structure, or level of formality');
    expect(agent.prompt).toContain("Preserve the author's message, tone, voice, intent, structure");
    expect(agent.prompt).toContain('Do not summarize, shorten, expand, soften, strengthen, formalize, casualize, or otherwise restyle');
    expect(agent.prompt).toContain('return the original text unchanged');
    expect(agent.contract?.mission).toContain('preserving the original message, tone, voice, intent, and structure');
  });

  it('exposes the new agents to the router prompt', async () => {
    const agents = await loadAgentRegistry(AGENTS_DIR);
    const prompt = buildRouterPrompt(agents, 'Build a feature with TDD and QA review');

    expect(prompt).toContain('spec-writer');
    expect(prompt).toContain('implementation-coder');
    expect(prompt).toContain('adviser');
    expect(prompt).toContain('Coding workflows with a reviewed and QA-approved spec must route through adviser before execution agents.');
    expect(prompt).toContain('github-review-merge-specialist');
    expect(prompt).toContain('test-driven development');
    expect(prompt).toContain('release-readiness-reviewer');
    expect(prompt).toContain('grammar-spelling-specialist');
    expect(prompt).toContain('output-formatter');
    expect(prompt).toContain('classyfire-taxonomy-classifier');
    expect(prompt).toContain('usage-classification-tree');
    expect(prompt).toContain('stabilization-reviewer');
    expect(prompt).toContain('Mission:');
    expect(prompt).toContain('Capabilities:');
  });

  it('validates the documented feature delivery DAG', () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'spec-writer', task: 'Create an implementation-ready specification', dependsOn: [] },
        { id: 'step-2', agent: 'spec-qa-reviewer', task: 'Review the specification', dependsOn: ['step-1'] },
        { id: 'step-3', agent: 'adviser', task: 'Recommend the best agent workflow from the reviewed and QA-approved spec', dependsOn: ['step-2'] },
        { id: 'step-4', agent: 'tdd-engineer', task: 'Write failing tests', dependsOn: ['step-3'] },
        { id: 'step-5', agent: 'implementation-coder', task: 'Implement the behavior', dependsOn: ['step-4'] },
        { id: 'step-6', agent: 'code-qa-analyst', task: 'Review the implementation', dependsOn: ['step-5'] },
        { id: 'step-7', agent: 'docs-maintainer', task: 'Update Markdown docs', dependsOn: ['step-6'] },
        { id: 'step-8', agent: 'stabilization-reviewer', task: 'Audit capability claims, specs, docs, and integration boundaries', dependsOn: ['step-7'] },
        { id: 'step-9', agent: 'release-readiness-reviewer', task: 'Assess readiness', dependsOn: ['step-8'] },
        { id: 'step-10', agent: 'github-review-merge-specialist', task: 'Perform the final GitHub PR review and merge the approved changes', dependsOn: ['step-9'] },
      ],
    };

    expect(validateDAGPlan(plan)).toEqual({ valid: true });
  });
});

function isExitCode(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === code;
}
