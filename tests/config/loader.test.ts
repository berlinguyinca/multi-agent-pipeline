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
  });

  it('parses valid YAML config', async () => {
    const yamlContent = `
outputDir: ./custom-output
gitCheckpoints: false
agents:
  spec:
    adapter: claude
  review:
    adapter: codex
  execute:
    adapter: ollama
    model: llama3
`;
    const configPath = path.join(tmpDir, 'pipeline.yaml');
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    const config = await loadConfig(configPath);
    expect(config.outputDir).toBe('./custom-output');
    expect(config.gitCheckpoints).toBe(false);
    expect(config.agents.execute.adapter).toBe('ollama');
    expect(config.agents.execute.model).toBe('llama3');
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
    expect(config.agents.spec.adapter).toBe('claude');
    expect(config.agents.review.adapter).toBe('codex');
    expect(config.agents.execute.adapter).toBe('claude');
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
});
