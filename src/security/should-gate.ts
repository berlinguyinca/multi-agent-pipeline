import type { AgentDefinition } from '../types/agent-definition.js';

export function shouldGateStep(agent: AgentDefinition): boolean {
  void agent;
  return true;
}
