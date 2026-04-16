import type { AgentDefinition } from '../types/agent-definition.js';

const HIGH_RISK_BUILTINS = new Set(['shell', 'http-api', 'db-connection']);

export function shouldGateStep(agent: AgentDefinition): boolean {
  if (agent.output.type === 'files' || agent.output.type === 'presentation') return true;

  return agent.tools.some((tool) => {
    if (tool.type === 'mcp') return true;
    return HIGH_RISK_BUILTINS.has(tool.name);
  });
}
