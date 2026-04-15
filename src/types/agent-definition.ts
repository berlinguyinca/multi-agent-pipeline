// src/types/agent-definition.ts
import type { AdapterType } from './adapter.js';

export type OutputType = 'answer' | 'data' | 'files' | 'presentation';

export interface AgentOutputConfig {
  type: OutputType;
}

export interface BuiltinToolConfig {
  type: 'builtin';
  name: string;
  config?: Record<string, unknown>;
}

export interface MCPToolConfig {
  type: 'mcp';
  uri: string;
}

export type AgentToolConfig = BuiltinToolConfig | MCPToolConfig;

export interface AgentStageConfig {
  name: string;
  prompt?: string;
}

export interface AgentContractInputs {
  required?: string[];
  optional?: string[];
}

export interface AgentContractVerification {
  requiredEvidence?: string[];
  forbiddenClaims?: string[];
}

export interface AgentContractHandoff {
  deliverable: string;
  includes?: string[];
}

export interface AgentContract {
  mission: string;
  capabilities: string[];
  nonGoals?: string[];
  inputs?: AgentContractInputs;
  process?: string[];
  decisionRules?: string[];
  escalationTriggers?: string[];
  verification?: AgentContractVerification;
  handoff?: AgentContractHandoff;
}

export interface AdapterFallback {
  adapter: AdapterType;
  model?: string;
}

export interface AgentDefinition {
  name: string;
  description: string;
  adapter: AdapterType;
  model?: string;
  prompt: string;
  pipeline: AgentStageConfig[];
  handles: string;
  output: AgentOutputConfig;
  tools: AgentToolConfig[];
  enabled?: boolean;
  fallbacks?: AdapterFallback[];
  think?: boolean;
  contract?: AgentContract;
}

const VALID_OUTPUT_TYPES: readonly OutputType[] = ['answer', 'data', 'files', 'presentation'];

export function isValidAgentDefinition(agent: AgentDefinition): boolean {
  if (!agent.name || typeof agent.name !== 'string') return false;
  if (!agent.description || typeof agent.description !== 'string') return false;
  if (!agent.prompt || typeof agent.prompt !== 'string') return false;
  if (!agent.handles || typeof agent.handles !== 'string') return false;
  if (!Array.isArray(agent.pipeline) || agent.pipeline.length === 0) return false;
  if (!agent.output || !VALID_OUTPUT_TYPES.includes(agent.output.type)) return false;
  if (agent.contract !== undefined && !isValidAgentContract(agent.contract)) return false;
  return true;
}

function isValidAgentContract(contract: AgentContract): boolean {
  if (!contract || typeof contract !== 'object') return false;
  if (!isNonEmptyString(contract.mission)) return false;
  if (!isStringList(contract.capabilities, true)) return false;
  if (!isOptionalStringList(contract.nonGoals)) return false;
  if (!isValidContractInputs(contract.inputs)) return false;
  if (!isOptionalStringList(contract.process)) return false;
  if (!isOptionalStringList(contract.decisionRules)) return false;
  if (!isOptionalStringList(contract.escalationTriggers)) return false;
  if (!isValidContractVerification(contract.verification)) return false;
  if (!isValidContractHandoff(contract.handoff)) return false;
  return true;
}

function isValidContractInputs(inputs: AgentContractInputs | undefined): boolean {
  if (inputs === undefined) return true;
  if (!inputs || typeof inputs !== 'object') return false;
  if (!isOptionalStringList(inputs.required)) return false;
  if (!isOptionalStringList(inputs.optional)) return false;
  return true;
}

function isValidContractVerification(
  verification: AgentContractVerification | undefined,
): boolean {
  if (verification === undefined) return true;
  if (!verification || typeof verification !== 'object') return false;
  if (!isOptionalStringList(verification.requiredEvidence)) return false;
  if (!isOptionalStringList(verification.forbiddenClaims)) return false;
  return true;
}

function isValidContractHandoff(handoff: AgentContractHandoff | undefined): boolean {
  if (handoff === undefined) return true;
  if (!handoff || typeof handoff !== 'object') return false;
  if (!isNonEmptyString(handoff.deliverable)) return false;
  if (!isOptionalStringList(handoff.includes)) return false;
  return true;
}

function isOptionalStringList(value: string[] | undefined): boolean {
  return value === undefined || isStringList(value);
}

function isStringList(value: string[], requireAtLeastOne = false): boolean {
  if (!Array.isArray(value)) return false;
  if (requireAtLeastOne && value.length === 0) return false;
  return value.every(isNonEmptyString);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
