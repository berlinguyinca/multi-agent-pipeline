import { describe, it, expect } from 'vitest';
import { createToolRegistry } from '../../src/tools/registry.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';

describe('createToolRegistry', () => {
  it('creates shell tool from builtin config', () => {
    const agent: AgentDefinition = { name: 'test', description: 'test', adapter: 'claude', prompt: 'test', pipeline: [{ name: 'run' }], handles: 'test', output: { type: 'files' }, tools: [{ type: 'builtin', name: 'shell', config: { allowedCommands: ['ls'] } }] };
    const tools = createToolRegistry(agent, '/tmp');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('shell');
  });

  it('creates file-read tool from builtin config', () => {
    const agent: AgentDefinition = { name: 'test', description: 'test', adapter: 'claude', prompt: 'test', pipeline: [{ name: 'run' }], handles: 'test', output: { type: 'files' }, tools: [{ type: 'builtin', name: 'file-read' }] };
    const tools = createToolRegistry(agent, '/tmp');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('file-read');
  });

  it('returns empty array for no tools', () => {
    const agent: AgentDefinition = { name: 'test', description: 'test', adapter: 'claude', prompt: 'test', pipeline: [{ name: 'run' }], handles: 'test', output: { type: 'answer' }, tools: [] };
    expect(createToolRegistry(agent, '/tmp')).toHaveLength(0);
  });

  it('skips unknown builtin tools', () => {
    const agent: AgentDefinition = { name: 'test', description: 'test', adapter: 'claude', prompt: 'test', pipeline: [{ name: 'run' }], handles: 'test', output: { type: 'files' }, tools: [{ type: 'builtin', name: 'unknown-tool' }] };
    expect(createToolRegistry(agent, '/tmp')).toHaveLength(0);
  });

  it('skips MCP tools', () => {
    const agent: AgentDefinition = { name: 'test', description: 'test', adapter: 'claude', prompt: 'test', pipeline: [{ name: 'run' }], handles: 'test', output: { type: 'files' }, tools: [{ type: 'mcp', uri: 'mcp://localhost:5432' }] };
    expect(createToolRegistry(agent, '/tmp')).toHaveLength(0);
  });
});
