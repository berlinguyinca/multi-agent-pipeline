import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentAdapter, AdapterConfig } from '../../src/types/adapter.js';
import {
  discoverAutonomousAgent,
  selectHardwareFitModel,
} from '../../src/agents/autonomous-discovery.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';

function generatedAgent(name: string, description = 'Analyzes invoices'): string {
  return `---AGENT_YAML---
name: ${name}
description: "${description}"
adapter: ollama
model: placeholder
prompt: prompt.md
pipeline:
  - name: analyze
handles: "${description}"
output:
  type: answer
tools: []
---PROMPT_MD---
# ${name}

Do not use emoji. Use a professional engineering tone.
Generate code and text output in a human-readable form.
Exceptions are allowed only for explicitly requested binary or media artifacts.

You are ${name}.`;
}

class FakeCreationAdapter implements AgentAdapter {
  readonly type = 'ollama' as const;
  readonly model: string | undefined;

  constructor(
    config: AdapterConfig,
    private readonly outputs: string[],
  ) {
    this.model = config.model;
  }

  async detect() {
    return { installed: true };
  }

  async *run(): AsyncGenerator<string, void, void> {
    yield this.outputs.shift() ?? generatedAgent('fallback-agent');
  }

  cancel() {}
}

describe('selectHardwareFitModel', () => {
  it('rejects oversized local models and chooses a model that fits configured local hardware', () => {
    const selection = selectHardwareFitModel({
      description: 'Create a chemistry taxonomy and metabolomics research agent',
      installedModels: ['giant-model:70b', 'qwen2.5:7b'],
      preferredModels: ['giant-model:70b'],
      ollama: { ...DEFAULT_CONFIG.ollama, maxLoadedModels: 2, numParallel: 2 },
      totalMemoryBytes: 16 * 1024 ** 3,
    });

    expect(selection.selected.model).toBe('qwen2.5:7b');
    expect(selection.selected.fitsHardware).toBe(true);
    expect(selection.rejected.some((candidate) => candidate.model === 'giant-model:70b')).toBe(true);
    expect(selection.rejected.find((candidate) => candidate.model === 'giant-model:70b')?.reason)
      .toContain('estimated');
  });

  it('reports small fallback candidates when researched candidates exceed local hardware', () => {
    const selection = selectHardwareFitModel({
      description: 'Create a large code review agent',
      installedModels: ['giant-model:70b'],
      preferredModels: ['giant-model:70b'],
      ollama: { ...DEFAULT_CONFIG.ollama, maxLoadedModels: 4, numParallel: 2 },
      totalMemoryBytes: 8 * 1024 ** 3,
    });

    expect(selection.selected.fitsHardware).toBe(true);
    expect(selection.candidates.map((candidate) => candidate.model)).toContain(selection.selected.model);
    expect(selection.rejected.map((candidate) => candidate.model)).toContain('giant-model:70b');
  });
});

describe('discoverAutonomousAgent', () => {
  it('generates three candidate agents, selects one consensus winner, verifies its model, and persists only the winner', async () => {
    const agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-generated-agents-'));
    const pulledModels: string[] = [];
    const outputs = [
      generatedAgent('invoice-generalist', 'Broad invoice helper'),
      generatedAgent('invoice-analysis-specialist', 'Analyzes invoice anomalies'),
      'not parseable',
    ];

    const result = await discoverAutonomousAgent({
      userTask: 'Analyze vendor invoice anomalies',
      agentsDir,
      config: {
        ...DEFAULT_CONFIG,
        agentCreation: { adapter: 'ollama', model: 'gemma4:26b' },
      },
      suggestedAgent: {
        name: 'invoice-analysis-specialist',
        description: 'Analyze invoice anomalies and vendor payment risks',
      },
      reason: 'No enabled invoice analysis specialist exists.',
      installedModels: [],
      totalMemoryBytes: 64 * 1024 ** 3,
      createAdapterFn: (config) => new FakeCreationAdapter(config, outputs),
      ensureModelReadyFn: async (model) => {
        pulledModels.push(model);
      },
    });

    expect(result.agent?.name).toBe('invoice-analysis-specialist');
    expect(result.diagnostics.status).toBe('created');
    expect(result.diagnostics.consensus.candidates).toHaveLength(3);
    expect(result.diagnostics.consensus.selectedCandidate).toBe(2);
    expect(result.diagnostics.model.selected.model).toBeTruthy();
    expect(pulledModels).toEqual([result.diagnostics.model.selected.model]);

    const entries = await fs.readdir(agentsDir);
    expect(entries).toEqual(['invoice-analysis-specialist']);
    const yaml = await fs.readFile(path.join(agentsDir, 'invoice-analysis-specialist', 'agent.yaml'), 'utf8');
    expect(yaml).toContain('generated: true');
    expect(yaml).toContain('generatedBy: router-self-discovery');
    expect(yaml).toContain(`model: ${result.diagnostics.model.selected.model}`);

    await fs.rm(agentsDir, { recursive: true, force: true });
  });

  it('does not pull a model or write files when all generated candidates are invalid', async () => {
    const agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-invalid-generated-agents-'));
    let pullCount = 0;
    const outputs = ['bad candidate 1', 'bad candidate 2', 'bad candidate 3'];

    const result = await discoverAutonomousAgent({
      userTask: 'Analyze vendor invoice anomalies',
      agentsDir,
      config: DEFAULT_CONFIG,
      suggestedAgent: {
        name: 'invoice-analysis-specialist',
        description: 'Analyze invoice anomalies and vendor payment risks',
      },
      reason: 'No enabled invoice analysis specialist exists.',
      installedModels: ['qwen2.5:7b'],
      totalMemoryBytes: 64 * 1024 ** 3,
      createAdapterFn: (config) => new FakeCreationAdapter(config, outputs),
      ensureModelReadyFn: async () => {
        pullCount += 1;
      },
    });

    expect(result.agent).toBeUndefined();
    expect(result.diagnostics.status).toBe('failed');
    expect(result.diagnostics.warnings).toContain('No valid generated agent candidate passed validation.');
    expect(pullCount).toBe(0);
    expect(await fs.readdir(agentsDir)).toEqual([]);

    await fs.rm(agentsDir, { recursive: true, force: true });
  });

  it('rejects existing non-generated agent name collisions before generating candidates', async () => {
    const agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-collision-generated-agents-'));
    await fs.mkdir(path.join(agentsDir, 'invoice-analysis-specialist'), { recursive: true });
    await fs.writeFile(path.join(agentsDir, 'invoice-analysis-specialist', 'agent.yaml'), [
      'name: invoice-analysis-specialist',
      'description: "Hand-written invoice specialist"',
      'adapter: ollama',
      'model: qwen2.5:7b',
      'prompt: prompt.md',
      'pipeline:',
      '  - name: analyze',
      'handles: "invoice analysis"',
      'output:',
      '  type: answer',
      'tools: []',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(agentsDir, 'invoice-analysis-specialist', 'prompt.md'), 'You analyze invoices.');
    let generated = false;

    const result = await discoverAutonomousAgent({
      userTask: 'Analyze vendor invoice anomalies',
      agentsDir,
      config: DEFAULT_CONFIG,
      suggestedAgent: {
        name: 'invoice-analysis-specialist',
        description: 'Analyze invoice anomalies and vendor payment risks',
      },
      reason: 'No enabled invoice analysis specialist exists.',
      installedModels: ['qwen2.5:7b'],
      totalMemoryBytes: 64 * 1024 ** 3,
      createAdapterFn: (config) => {
        generated = true;
        return new FakeCreationAdapter(config, [generatedAgent('invoice-analysis-specialist')]);
      },
      ensureModelReadyFn: async () => {},
    });

    expect(result.agent).toBeUndefined();
    expect(result.diagnostics.status).toBe('skipped');
    expect(result.diagnostics.warnings.join('\n')).toContain('already exists');
    expect(generated).toBe(false);

    await fs.rm(agentsDir, { recursive: true, force: true });
  });

  it('records model verification failures without persisting the selected candidate', async () => {
    const agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-pull-failed-generated-agents-'));
    const result = await discoverAutonomousAgent({
      userTask: 'Analyze vendor invoice anomalies',
      agentsDir,
      config: DEFAULT_CONFIG,
      suggestedAgent: {
        name: 'invoice-analysis-specialist',
        description: 'Analyze invoice anomalies and vendor payment risks',
      },
      reason: 'No enabled invoice analysis specialist exists.',
      installedModels: ['qwen2.5:7b'],
      totalMemoryBytes: 64 * 1024 ** 3,
      createAdapterFn: (config) => new FakeCreationAdapter(config, [
        generatedAgent('invoice-analysis-specialist', 'Analyzes invoice anomalies'),
        'bad candidate',
        'bad candidate',
      ]),
      ensureModelReadyFn: async () => {
        throw new Error('pull failed');
      },
    });

    expect(result.agent).toBeUndefined();
    expect(result.diagnostics.status).toBe('failed');
    expect(result.diagnostics.warnings.join('\n')).toContain('pull failed');
    expect(await fs.readdir(agentsDir)).toEqual([]);

    await fs.rm(agentsDir, { recursive: true, force: true });
  });

  it('does not overwrite an unexpected existing generated-agent directory', async () => {
    const agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-existing-dir-generated-agents-'));
    await fs.mkdir(path.join(agentsDir, 'invoice-analysis-specialist'), { recursive: true });
    await fs.writeFile(path.join(agentsDir, 'invoice-analysis-specialist', 'notes.txt'), 'keep me', 'utf8');

    const result = await discoverAutonomousAgent({
      userTask: 'Analyze vendor invoice anomalies',
      agentsDir,
      config: DEFAULT_CONFIG,
      suggestedAgent: {
        name: 'invoice-analysis-specialist',
        description: 'Analyze invoice anomalies and vendor payment risks',
      },
      reason: 'No enabled invoice analysis specialist exists.',
      installedModels: ['qwen2.5:7b'],
      totalMemoryBytes: 64 * 1024 ** 3,
      createAdapterFn: (config) => new FakeCreationAdapter(config, [
        generatedAgent('invoice-analysis-specialist', 'Analyzes invoice anomalies'),
        'bad candidate',
        'bad candidate',
      ]),
      ensureModelReadyFn: async () => {},
    });

    expect(result.agent).toBeUndefined();
    expect(result.diagnostics.status).toBe('failed');
    expect(result.diagnostics.warnings.join('\n')).toContain('unexpected existing directory');
    await expect(fs.readFile(path.join(agentsDir, 'invoice-analysis-specialist', 'notes.txt'), 'utf8'))
      .resolves.toBe('keep me');

    await fs.rm(agentsDir, { recursive: true, force: true });
  });
});
