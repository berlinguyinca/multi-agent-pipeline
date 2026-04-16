import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/config/loader.js';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-config-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when no file exists', async () => {
    const config = await loadConfig(path.join(tmpDir, 'nonexistent.yaml'));
    expect(config.outputDir).toBe('./output');
    expect(config.gitCheckpoints).toBe(true);
    expect(config.agents.spec.adapter).toBe('claude');
    expect(config.agents.qa.adapter).toBe('codex');
    expect(config.agents.docs.adapter).toBe('claude');
    expect(config.ollama.host).toBe('http://localhost:11434');
    expect(config.quality.maxSpecQaIterations).toBe(3);
    expect(config.quality.maxCodeQaIterations).toBe(3);
    expect(config.router.timeoutMs).toBe(300_000);
    expect(config.headless.totalTimeoutMs).toBe(60 * 60 * 1000);
    expect(config.headless.inactivityTimeoutMs).toBe(10 * 60 * 1000);
    expect(config.headless.pollIntervalMs).toBe(10 * 1000);
  });

  it('parses valid YAML config', async () => {
    const yamlContent = `
outputDir: ./custom-output
gitCheckpoints: false
generateAgentSummary: false
agents:
  spec:
    adapter: claude
  review:
    adapter: codex
  execute:
    adapter: ollama
    model: llama3
  qa:
    adapter: ollama
    model: qwen
  docs:
    adapter: ollama
    model: mistral
ollama:
  host: http://127.0.0.1:11435
quality:
  maxSpecQaIterations: 2
  maxCodeQaIterations: 4
`;
    const configPath = path.join(tmpDir, 'pipeline.yaml');
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    const config = await loadConfig(configPath);
    expect(config.outputDir).toBe('./custom-output');
    expect(config.gitCheckpoints).toBe(false);
    expect(config.generateAgentSummary).toBe(false);
    expect(config.agents.execute.adapter).toBe('ollama');
    expect(config.agents.execute.model).toBe('llama3');
    expect(config.agents.qa.adapter).toBe('ollama');
    expect(config.agents.qa.model).toBe('qwen');
    expect(config.agents.docs.adapter).toBe('ollama');
    expect(config.agents.docs.model).toBe('mistral');
    expect(config.ollama.host).toBe('http://127.0.0.1:11435');
    expect(config.quality.maxSpecQaIterations).toBe(2);
    expect(config.quality.maxCodeQaIterations).toBe(4);
  });

  it('parses router consensus config', async () => {
    const yamlContent = `
router:
  adapter: ollama
  model: gemma4
  consensus:
    enabled: true
    models:
      - gemma4
      - qwen3
      - llama3
    scope: router
    mode: majority
`;
    const configPath = path.join(tmpDir, 'pipeline.yaml');
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    const config = await loadConfig(configPath);

    expect(config.router.consensus).toEqual({
      enabled: true,
      models: ['gemma4', 'qwen3', 'llama3'],
      scope: 'router',
      mode: 'majority',
    });
  });

  it('parses local agent consensus config', async () => {
    const yamlContent = `
agentConsensus:
  enabled: true
  runs: 5
  outputTypes: [answer, data]
  minSimilarity: 0.6
  fileOutputs:
    enabled: true
    runs: 3
    isolation: git-worktree
    keepWorktreesOnFailure: false
    verificationCommands:
      - npm run typecheck
    selection: best-passing-minimal-diff
`;
    const configPath = path.join(tmpDir, 'pipeline.yaml');
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    const config = await loadConfig(configPath);

    expect(config.agentConsensus).toEqual({
      enabled: true,
      runs: 5,
      outputTypes: ['answer', 'data'],
      minSimilarity: 0.6,
      fileOutputs: {
        enabled: true,
        runs: 3,
        isolation: 'git-worktree',
        keepWorktreesOnFailure: false,
        verificationCommands: ['npm run typecheck'],
        selection: 'best-passing-minimal-diff',
      },
    });
  });

  it('rejects invalid local agent consensus output types', async () => {
    const yamlContent = `
agentConsensus:
  outputTypes: [answer, files, nonsense]
`;
    const configPath = path.join(tmpDir, 'pipeline.yaml');
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    await expect(loadConfig(configPath)).rejects.toThrow('agentConsensus.outputTypes');
  });

  it('rejects more than three router consensus models', async () => {
    const yamlContent = `
router:
  consensus:
    enabled: true
    models: [a, b, c, d]
`;
    const configPath = path.join(tmpDir, 'pipeline.yaml');
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    await expect(loadConfig(configPath)).rejects.toThrow('router.consensus.models');
  });

  it('rejects unsupported router consensus scope', async () => {
    const yamlContent = `
router:
  consensus:
    enabled: true
    models: [gemma4]
    scope: all
`;
    const configPath = path.join(tmpDir, 'pipeline.yaml');
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    await expect(loadConfig(configPath)).rejects.toThrow('router.consensus.scope');
  });

  it('merges partial config with defaults', async () => {
    const yamlContent = `
outputDir: ./my-output
`;
    const configPath = path.join(tmpDir, 'pipeline.yaml');
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    const config = await loadConfig(configPath);
    expect(config.outputDir).toBe('./my-output');
    // Defaults preserved for unspecified fields
    expect(config.gitCheckpoints).toBe(true);
    expect(config.generateAgentSummary).toBe(true);
    expect(config.agents.spec.adapter).toBe('claude');
    expect(config.agents.review.adapter).toBe('codex');
    expect(config.agents.qa.adapter).toBe('codex');
    expect(config.agents.execute.adapter).toBe('claude');
    expect(config.agents.docs.adapter).toBe('claude');
    expect(config.ollama.host).toBe('http://localhost:11434');
    expect(config.router.timeoutMs).toBe(300_000);
    expect(config.headless.totalTimeoutMs).toBe(60 * 60 * 1000);
  });

  it('throws on invalid agent summary config', async () => {
    const yamlContent = `
generateAgentSummary: yes-please
`;
    const configPath = path.join(tmpDir, 'pipeline.yaml');
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    await expect(loadConfig(configPath)).rejects.toThrow('generateAgentSummary');
  });

  it('parses headless runtime config values', async () => {
    const yamlContent = `
headless:
  totalTimeoutMs: 45m
  inactivityTimeoutMs: 5m
  pollIntervalMs: 15s
`;
    const configPath = path.join(tmpDir, 'pipeline.yaml');
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    const config = await loadConfig(configPath);
    expect(config.headless.totalTimeoutMs).toBe(45 * 60 * 1000);
    expect(config.headless.inactivityTimeoutMs).toBe(5 * 60 * 1000);
    expect(config.headless.pollIntervalMs).toBe(15 * 1000);
  });

  it('throws on invalid adapter type', async () => {
    const yamlContent = `
agents:
  spec:
    adapter: gpt4
  review:
    adapter: codex
  execute:
    adapter: claude
  qa:
    adapter: codex
`;
    const configPath = path.join(tmpDir, 'pipeline.yaml');
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it('throws when ollama adapter has no model', async () => {
    const yamlContent = `
agents:
  spec:
    adapter: ollama
  review:
    adapter: codex
  execute:
    adapter: claude
`;
    const configPath = path.join(tmpDir, 'pipeline.yaml');
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it('throws when docs ollama adapter has no model', async () => {
    const yamlContent = `
agents:
  docs:
    adapter: ollama
`;
    const configPath = path.join(tmpDir, 'pipeline.yaml');
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it('throws on invalid headless runtime config', async () => {
    const yamlContent = `
headless:
  totalTimeoutMs: nope
`;
    const configPath = path.join(tmpDir, 'pipeline.yaml');
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it('throws when merged headless runtime config has an invalid relationship', async () => {
    const yamlContent = `
headless:
  pollIntervalMs: 15m
`;
    const configPath = path.join(tmpDir, 'pipeline.yaml');
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it('throws on invalid quality iteration limits', async () => {
    const yamlContent = `
quality:
  maxSpecQaIterations: 0
`;
    const configPath = path.join(tmpDir, 'pipeline.yaml');
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    await expect(loadConfig(configPath)).rejects.toThrow();
  });
});
