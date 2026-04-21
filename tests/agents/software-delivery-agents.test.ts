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
  'code-qa-gemma',
  'code-qa-qwen',
  'code-qa-glm',
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
  'legal-license-advisor',
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

      if (name === 'legal-license-advisor' || name === 'docs-maintainer' || name === 'release-readiness-reviewer') {
        expect(agent.adapter).toBe('metadata');
        expect(agent.model).toBe(name);
        continue;
      }
      if (name === 'code-qa-analyst') {
        expect(agent.adapter).toBe('metadata');
        expect(agent.model).toBe('code-qa-consensus');
        continue;
      }
      expect(agent.adapter).toBe('ollama');
      if (name === 'code-qa-gemma') {
        expect(agent.model).toBe('gemma4:26b');
      } else if (name === 'code-qa-qwen') {
        expect(agent.model).toBe('qwen3.6:latest');
      } else if (name === 'code-qa-glm') {
        expect(agent.model).toBe('glm-4.7-flash:latest');
      } else if (name === 'usage-classification-fact-checker' || name === 'research-fact-checker') {
        expect(agent.model).toBe('bespoke-minicheck:7b');
      } else if (['tdd-engineer', 'implementation-coder', 'build-fixer', 'test-stabilizer'].includes(name)) {
        expect(agent.model).toBe('qwen3.6:latest');
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
    expect(classyfire.prompt).toContain('Never use `sourceType: "model-prior"` for high-confidence taxonomy claims');
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

  it('requires usage tree row identifiers to be unique', async () => {
    const usage = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'usage-classification-tree'));

    expect(usage.prompt).toContain('Usage Tree row identifiers must be unique');
    expect(usage.prompt).toContain('Level 2.1');
  });

  it('requires every positive LCB exposure category to appear in commonness ranking', async () => {
    const usage = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'usage-classification-tree'));

    expect(usage.prompt).toContain('Every LCB Exposure Summary row marked `yes` must have a corresponding Usage Commonness Ranking row');
    expect(usage.prompt).toContain('each individual positive usage scenario');
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
    expect(usage.prompt).toContain('Claim Evidence Ledger');
    expect(usage.prompt).toContain('Mandatory Tool-Use Protocol');
    expect(usage.prompt).toContain('your first response must be a single JSON tool call to `web-search`');
    expect(usage.prompt).toContain('use the available `web-search` tool');
    expect(usage.prompt).toContain('Never use `sourceType: "model-prior"` for high-confidence claims');
    expect(usage.prompt).toContain('"claimType": "commonness-score"');
    expect(usage.prompt).toContain('"recencyStatus": "current"');
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

  it('requires fact-critical agents to emit claim evidence ledgers', async () => {
    const researcher = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'researcher'));
    const classyfire = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'classyfire-taxonomy-classifier'));
    const security = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'security-advisor'));
    const legal = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'legal-license-advisor'));
    const readiness = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'release-readiness-reviewer'));

    for (const agent of [researcher, classyfire, security, legal, readiness]) {
      expect(agent.prompt, `${agent.name} missing ledger`).toContain('Claim Evidence Ledger');
      expect(agent.prompt, `${agent.name} missing claims JSON`).toContain('"claims"');
      expect(agent.prompt, `${agent.name} missing evidence field`).toContain('"evidence"');
    }
    expect(classyfire.prompt).toContain('"claimType": "chemical-taxonomy"');
    expect(readiness.prompt).toContain('"claimType": "test-result"');
    expect(security.prompt).toContain('tool-output');
  });




  it('uses coding models and action-first prompts for execution-heavy file agents', async () => {
    for (const name of ['implementation-coder', 'build-fixer', 'test-stabilizer'] as const) {
      const agent = await loadAgentFromDirectory(path.join(AGENTS_DIR, name));

      expect(agent.adapter).toBe('ollama');
      expect(agent.model).toBe('qwen3.6:latest');
      expect(agent.prompt, `${name} missing action-first protocol`).toContain('Action-First Tool Protocol');
      expect(agent.prompt, `${name} missing first tool call guidance`).toContain('first response must be a JSON shell tool call');
      expect(agent.prompt, `${name} missing empty response ban`).toContain('Do not return an empty response');
    }
  });

  it('hardens review, docs, and readiness agents against missing artifacts', async () => {
    const qa = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'code-qa-analyst'));
    const docs = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'docs-maintainer'));
    const readiness = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'release-readiness-reviewer'));
    const adviser = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'adviser'));

    expect(qa.prompt).toContain('No implementation artifacts means no approval');
    expect(qa.prompt).toContain('Structured QA Verdict');
    expect(qa.prompt).toContain('"verdict": "accept|revise|reject"');
    expect(qa.prompt).toContain('blockingFindings');
    expect(docs.prompt).toContain('Do not edit documentation when implementation artifacts are missing');
    expect(readiness.prompt).toContain('Hard readiness blockers');
    expect(adviser.prompt).toContain('Valid implementation agents');
    expect(adviser.prompt).toContain('implementation-coder');
    expect(adviser.prompt).toContain('Do not invent agent names');
  });

  it('requires docs-maintainer to produce release README and license coverage after software builds', async () => {
    const docs = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'docs-maintainer'));

    expect(docs.prompt).toContain('Release Documentation Contract');
    expect(docs.prompt).toContain('README');
    expect(docs.prompt).toContain('what the tool does');
    expect(docs.prompt).toContain('how to use the tool');
    expect(docs.prompt).toContain('LICENSE');
    expect(docs.prompt).toContain('Do not invent license terms');
    expect(docs.adapter).toBe('metadata');
    expect(docs.model).toBe('docs-maintainer');
    expect(docs.contract?.capabilities).toContain('Create or update release README documentation for completed user-facing software tools.');
    expect(docs.contract?.capabilities).toContain('Ensure license coverage is present or report the exact license-choice blocker.');
    expect(docs.contract?.handoff.includes).toContain('README usage documentation');
    expect(docs.contract?.handoff.includes).toContain('License file or license blocker');
  });

  it('loads a legal-license-advisor that recommends compatible license options from language and library evidence', async () => {
    const legal = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'legal-license-advisor'));

    expect(legal.adapter).toBe('metadata');
    expect(legal.model).toBe('legal-license-advisor');
    expect(legal.handles).toContain('license recommendations');
    expect(legal.prompt).toContain('License Recommendation Contract');
    expect(legal.prompt).toContain('based on utilized languages and libraries');
    expect(legal.prompt).toContain('SPDX');
    expect(legal.prompt).toContain('not legal advice');
    expect(legal.prompt).toContain('Do not create or modify LICENSE files');
    expect(legal.contract?.capabilities).toContain('Recommend a short list of compatible license options based on detected languages, package manifests, and dependency license evidence.');
    expect(legal.contract?.handoff.includes).toContain('Recommended license options');
    expect(legal.contract?.handoff.includes).toContain('Compatibility caveats');
  });

  it('requires adviser workflows to schedule docs-maintainer for README and license handoff after verified software builds', async () => {
    const adviser = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'adviser'));

    expect(adviser.prompt).toContain('After verified software builds');
    expect(adviser.prompt).toContain('docs-maintainer');
    expect(adviser.prompt).toContain('legal-license-advisor');
    expect(adviser.prompt).toContain('README');
    expect(adviser.prompt).toContain('LICENSE');
  });

  it('uses the stronger Qwen coding model and action-first prompt for TDD test authoring', async () => {
    const tdd = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'tdd-engineer'));

    expect(tdd.adapter).toBe('ollama');
    expect(tdd.model).toBe('qwen3.6:latest');
    expect(tdd.prompt).toContain('Action-First Tool Protocol');
    expect(tdd.prompt).toContain('first response must be a JSON shell tool call');
    expect(tdd.prompt).toContain('write at least one focused failing test file');
    expect(tdd.prompt).toContain('Do not return an empty response');
    expect(tdd.prompt).toContain('If the workspace is greenfield or nearly empty');
    expect(tdd.prompt).toContain('Do not repeat the same inspection command');
  });


  it('requires every file-output agent to have editing tools and a file-output contract', async () => {
    const agents = await loadAgentRegistry(AGENTS_DIR);
    const fileAgents = [...agents.values()].filter((agent) => agent.output.type === 'files');

    expect(fileAgents.length).toBeGreaterThan(0);
    for (const agent of fileAgents) {
      expect(agent.tools.some((tool) => tool.type === 'builtin' && tool.name === 'shell'), `${agent.name} missing shell tool`).toBe(true);
      expect(agent.prompt, `${agent.name} missing file-output contract`).toContain('File-Output Contract');
      expect(agent.prompt, `${agent.name} missing workspace edit instruction`).toContain('create or modify the requested files in the workspace');
      expect(agent.prompt, `${agent.name} missing verification instruction`).toContain('verification command/result');
    }
  });

  it('requires implementation file-output agents to edit workspace files and report verification', async () => {
    const tdd = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'tdd-engineer'));
    const delivery = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'software-delivery'));
    const implementation = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'implementation-coder'));

    for (const agent of [tdd, delivery, implementation]) {
      expect(agent.prompt, `${agent.name} missing file-output contract`).toContain('File-Output Contract');
      expect(agent.prompt, `${agent.name} missing workspace edit instruction`).toContain('create or modify the requested files in the workspace');
      expect(agent.prompt, `${agent.name} missing verification instruction`).toContain('verification command/result');
    }
    expect(implementation.prompt).toContain('If the workspace is greenfield or nearly empty');
    expect(implementation.prompt).toContain('Remediation Override');
    expect(implementation.prompt).toContain('Do not inspect the same files again');
    expect(delivery.prompt).toContain('Do not spend multiple rounds repeating the same inspection command');
    expect(delivery.prompt).toContain('Remediation Override');
  });



  it('loads a three-model code QA panel with distinct model families', async () => {
    const gemma = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'code-qa-gemma'));
    const qwen = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'code-qa-qwen'));
    const glm = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'code-qa-glm'));
    const consensus = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'code-qa-analyst'));

    expect(gemma.model).toBe('gemma4:26b');
    expect(qwen.model).toBe('qwen3.6:latest');
    expect(glm.model).toBe('glm-4.7-flash:latest');
    expect(new Set([gemma.model, qwen.model, glm.model]).size).toBe(3);
    expect(consensus.model).toBe('code-qa-consensus');
  });

  it('requires software development agents to run tests in isolated Docker-backed service environments when databases are needed', async () => {
    const agents = await Promise.all([
      'tdd-engineer',
      'implementation-coder',
      'software-delivery',
      'build-fixer',
      'test-stabilizer',
      'code-qa-analyst',
  'code-qa-gemma',
  'code-qa-qwen',
  'code-qa-glm',
      'adviser',
    ].map((name) => loadAgentFromDirectory(path.join(AGENTS_DIR, name))));

    for (const agent of agents) {
      expect(agent.prompt, `${agent.name} missing isolated test environment contract`).toContain('Isolated Test Environment Contract');
      expect(agent.prompt, `${agent.name} missing Docker service guidance`).toContain('Docker');
      expect(agent.prompt, `${agent.name} missing host database ban`).toContain('Do not connect tests to host databases');
      expect(agent.prompt, `${agent.name} missing test verification evidence`).toContain('test command');
    }
  });

  it('loads strict source metadata generator agents as non-LLM metadata adapters', async () => {
    const insight = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'insightcode-metadata'));
    const codefetch = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'codefetch-metadata'));
    const codesight = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'codesight-metadata'));

    for (const agent of [insight, codefetch, codesight]) {
      expect(agent.adapter).toBe('metadata');
      expect(agent.output.type).toBe('data');
      expect(agent.prompt).toContain('strict metadata generator');
      expect(agent.prompt).toContain('Do not modify source files');
      expect(agent.contract?.nonGoals?.join(' ')).toContain('Do not edit');
    }
    expect(insight.model).toBe('insightcode');
    expect(codefetch.model).toBe('codefetch');
    expect(codesight.model).toBe('codesight');
  });

  it('loads model-installer as a gemma4-backed agent for Ollama/Hugging Face setup', async () => {
    const installer = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'model-installer'));

    expect(installer.adapter).toBe('ollama');
    expect(installer.model).toBe('gemma4:26b');
    expect(installer.prompt).toContain('Hugging Face');
    expect(installer.prompt).toContain('ollama pull hf.co');
    expect(installer.tools).toContainEqual(expect.objectContaining({
      type: 'builtin',
      name: 'shell',
    }));
  });

  it('loads prompt-refiner as a gemma4-backed Socratic refinement agent', async () => {
    const refiner = await loadAgentFromDirectory(path.join(AGENTS_DIR, 'prompt-refiner'));

    expect(refiner.adapter).toBe('ollama');
    expect(refiner.model).toBe('gemma4:26b');
    expect(refiner.output.type).toBe('data');
    expect(refiner.prompt).toContain('Socratic');
    expect(refiner.prompt).toContain('Teacher');
    expect(refiner.prompt).toContain('Critic');
    expect(refiner.prompt).toContain('Student');
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
    expect(prompt).toContain('legal-license-advisor');
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
        { id: 'step-7', agent: 'legal-license-advisor', task: 'Recommend compatible license options from language and dependency evidence', dependsOn: ['step-6'] },
        { id: 'step-8', agent: 'docs-maintainer', task: 'Update README docs and license coverage', dependsOn: ['step-7'] },
        { id: 'step-9', agent: 'stabilization-reviewer', task: 'Audit capability claims, specs, docs, and integration boundaries', dependsOn: ['step-8'] },
        { id: 'step-10', agent: 'release-readiness-reviewer', task: 'Assess readiness', dependsOn: ['step-9'] },
        { id: 'step-11', agent: 'github-review-merge-specialist', task: 'Perform the final GitHub PR review and merge the approved changes', dependsOn: ['step-10'] },
      ],
    };

    expect(validateDAGPlan(plan)).toEqual({ valid: true });
  });
});

function isExitCode(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === code;
}
