import type { AgentContract } from '../types/agent-definition.js';

export function buildRoleContractPrompt(contract: AgentContract | undefined): string {
  if (!contract) return '';

  const lines = [
    '## Role Contract',
    '',
    `Mission: ${contract.mission}`,
    '',
    `Capabilities: ${contract.capabilities.join('; ')}`,
  ];

  appendListSection(lines, 'Non-goals', contract.nonGoals);
  appendInputsSection(lines, contract);
  appendListSection(lines, 'Process', contract.process);
  appendListSection(lines, 'Decision rules', contract.decisionRules);
  appendListSection(lines, 'Escalation triggers', contract.escalationTriggers);

  if (contract.verification) {
    appendListSection(lines, 'Verification required evidence', contract.verification.requiredEvidence);
    appendListSection(lines, 'Verification forbidden claims', contract.verification.forbiddenClaims);
  }

  if (contract.handoff) {
    lines.push('', `Handoff deliverable: ${contract.handoff.deliverable}`);
    if (contract.handoff.includes && contract.handoff.includes.length > 0) {
      lines.push(`Handoff includes: ${contract.handoff.includes.join('; ')}`);
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

export function buildRoleRoutingSummary(contract: AgentContract | undefined): string {
  if (!contract) return '';

  const parts = [`Mission: ${contract.mission}`];
  if (contract.capabilities.length > 0) {
    parts.push(`Capabilities: ${contract.capabilities.join('; ')}`);
  }
  return parts.join(' ');
}

function appendInputsSection(lines: string[], contract: AgentContract): void {
  const required = contract.inputs?.required;
  const optional = contract.inputs?.optional;

  if ((!required || required.length === 0) && (!optional || optional.length === 0)) {
    return;
  }

  lines.push('');
  if (required && required.length > 0) {
    lines.push(`Inputs required: ${required.join('; ')}`);
  }
  if (optional && optional.length > 0) {
    lines.push(`Inputs optional: ${optional.join('; ')}`);
  }
}

function appendListSection(lines: string[], title: string, items: string[] | undefined): void {
  if (!items || items.length === 0) return;
  lines.push('', `${title}: ${items.join('; ')}`);
}
