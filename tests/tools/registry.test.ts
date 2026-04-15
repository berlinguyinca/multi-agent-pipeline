import { describe, it, expect } from 'vitest';
import { createToolRegistry } from '../../src/tools/registry.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';

describe('createToolRegistry', () => {
  it('creates shell tool from builtin config', () => {
    const agent: AgentDefinition = { name: 'test', description: 'test', adapter: 'claude', prompt: 'test', pipeline: [{ name: 'run' }], handles: 'test', output: { type: 'files' }, tools: [{ type: 'builtin', name: 'shell', config: { allowedCommands: ['ls'] } }] };
    const tools = createToolRegistry(agent, '/tmp');
    expect(tools.map((tool) => tool.name)).toEqual(['knowledge-search', 'shell']);
  });

  it('creates file-read tool from builtin config', () => {
    const agent: AgentDefinition = { name: 'test', description: 'test', adapter: 'claude', prompt: 'test', pipeline: [{ name: 'run' }], handles: 'test', output: { type: 'files' }, tools: [{ type: 'builtin', name: 'file-read' }] };
    const tools = createToolRegistry(agent, '/tmp');
    expect(tools.map((tool) => tool.name)).toEqual(['knowledge-search', 'file-read']);
  });

  it('provides knowledge-search even when no explicit tools are configured', () => {
    const agent: AgentDefinition = { name: 'test', description: 'test', adapter: 'claude', prompt: 'test', pipeline: [{ name: 'run' }], handles: 'test', output: { type: 'answer' }, tools: [] };
    expect(createToolRegistry(agent, '/tmp').map((tool) => tool.name)).toEqual(['knowledge-search']);
  });

  it('skips unknown builtin tools', () => {
    const agent: AgentDefinition = { name: 'test', description: 'test', adapter: 'claude', prompt: 'test', pipeline: [{ name: 'run' }], handles: 'test', output: { type: 'files' }, tools: [{ type: 'builtin', name: 'unknown-tool' }] };
    expect(createToolRegistry(agent, '/tmp').map((tool) => tool.name)).toEqual(['knowledge-search']);
  });

  it('skips MCP tools', () => {
    const agent: AgentDefinition = { name: 'test', description: 'test', adapter: 'claude', prompt: 'test', pipeline: [{ name: 'run' }], handles: 'test', output: { type: 'files' }, tools: [{ type: 'mcp', uri: 'mcp://localhost:5432' }] };
    expect(createToolRegistry(agent, '/tmp').map((tool) => tool.name)).toEqual(['knowledge-search']);
  });
});
