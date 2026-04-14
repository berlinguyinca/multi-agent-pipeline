import type { AgentDefinition } from '../types/agent-definition.js';

export function shouldGateStep(agent: AgentDefinition): boolean {
  if (agent.output.type === 'files') return true;
  if (agent.tools.some((t) => t.type === 'builtin' && t.name === 'shell')) return true;
  return false;
}
