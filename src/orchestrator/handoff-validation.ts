import { parseAdviserWorkflow } from '../adviser/workflow.js';
import { extractAcceptanceCriteria } from '../types/spec.js';
import type { DAGStep, HandoffFinding, SpecConformance, StepResult } from '../types/dag.js';

export interface HandoffValidationOptions {
  step: DAGStep;
  result: StepResult;
  priorResults: Map<string, StepResult>;
  reviewedSpecContent?: string;
}

export interface HandoffValidationResult {
  handoffPassed: boolean;
  handoffFindings: HandoffFinding[];
  specConformance: SpecConformance;
}

export function validateStepHandoff(options: HandoffValidationOptions): HandoffValidationResult {
  const findings: HandoffFinding[] = [];
  const output = options.result.output?.trim() ?? '';

  if (isOutputRequired(options.result) && output.length === 0) {
    findings.push(finding('high', 'Step completed without usable output.', options.step.id));
  }

  if (options.step.agent === 'adviser' && output.includes('adviser-workflow')) {
    const workflow = parseAdviserWorkflow(output);
    if (!workflow) {
      findings.push(finding('high', 'Invalid adviser workflow JSON; cannot safely mutate the DAG.', options.step.id));
    }
  }

  if (options.step.agent === 'grammar-spelling-specialist') {
    findings.push(...validateGrammarPreservation(options));
  }

  const specConformance = evaluateSpecConformance(options, output);
  for (const criterion of specConformance.missingCriteria) {
    findings.push(finding('medium', `Output does not clearly address acceptance criterion: ${criterion}`, options.step.id));
  }

  return {
    handoffPassed: !findings.some((item) => item.severity === 'high'),
    handoffFindings: findings,
    specConformance,
  };
}

function isOutputRequired(result: StepResult): boolean {
  return result.outputType === 'answer' || result.outputType === 'data' || result.outputType === 'presentation';
}

function validateGrammarPreservation(options: HandoffValidationOptions): HandoffFinding[] {
  const source = firstDependencyOutput(options.step, options.priorResults);
  const output = options.result.output?.trim() ?? '';
  if (!source || !output) return [];

  const findings: HandoffFinding[] = [];
  const sourceWords = tokenize(source);
  const outputWords = tokenize(output);
  const ratio = outputWords.length / Math.max(1, sourceWords.length);

  if (ratio < 0.75 || ratio > 1.35) {
    findings.push(finding('high', 'Grammar-polished output changed length too much; possible summary, expansion, or tone/message change.', options.step.id));
  }

  const missingTerms = protectedTerms(source).filter((term) => !output.includes(term));
  if (missingTerms.length > 0) {
    findings.push(finding('high', `Grammar-polished output dropped protected terms: ${missingTerms.slice(0, 5).join(', ')}`, options.step.id));
  }

  if (countMarkdownStructure(source) !== countMarkdownStructure(output)) {
    findings.push(finding('high', 'Grammar-polished output changed Markdown/list structure.', options.step.id));
  }

  return findings;
}

function evaluateSpecConformance(options: HandoffValidationOptions, output: string): SpecConformance {
  const criteria = options.reviewedSpecContent ? extractAcceptanceCriteria(options.reviewedSpecContent) : [];
  const shouldCheck = criteria.length > 0 && shouldCheckSpec(options.step.agent);
  if (!shouldCheck) {
    return { checked: false, passed: true, missingCriteria: [], notes: [] };
  }

  const missingCriteria = criteria.filter((criterion) => !criterionAppearsAddressed(criterion, output));
  return {
    checked: true,
    passed: missingCriteria.length === 0,
    missingCriteria,
    notes: missingCriteria.length > 0 ? ['Spec conformance is token-based and should be confirmed by QA for ambiguous criteria.'] : [],
  };
}

function shouldCheckSpec(agent: string): boolean {
  return /implementation|coder|code-qa|release|readiness|docs|maintainer|software-delivery/.test(agent);
}

function criterionAppearsAddressed(criterion: string, output: string): boolean {
  const outputTokens = new Set(tokenize(output));
  const significant = tokenize(criterion).filter((token) => token.length >= 4);
  if (significant.length === 0) return true;
  const matches = significant.filter((token) => outputTokens.has(token)).length;
  return matches / significant.length >= 0.5;
}

function firstDependencyOutput(step: DAGStep, priorResults: Map<string, StepResult>): string | null {
  for (const dep of step.dependsOn) {
    const output = priorResults.get(dep)?.output?.trim();
    if (output) return output;
  }
  return null;
}

function protectedTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const match of text.matchAll(/`([^`]+)`|\b[A-Z][A-Z0-9_-]{2,}\b|\b[A-Za-z]+[A-Z][A-Za-z0-9_-]*\b|\b\d+(?:\.\d+)?\s*(?:ms|s|seconds?|minutes?|hours?|%)?\b/g)) {
    const term = (match[1] ?? match[0]).trim();
    if (term.length > 0) terms.add(term);
  }
  return [...terms];
}

function countMarkdownStructure(text: string): number {
  return text.split('\n').filter((line) => /^\s*(#{1,6}\s+|[-*+]\s+|\d+\.\s+)/.test(line)).length;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function finding(severity: HandoffFinding['severity'], message: string, sourceStepId: string): HandoffFinding {
  return { severity, message, sourceStepId };
}
