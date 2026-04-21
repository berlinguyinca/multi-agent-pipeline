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
  if (output.length > 0 && isProtocolAcknowledgment(output)) {
    findings.push(finding('high', 'Step returned protocol acknowledgment without substantive task output.', options.step.id));
  }
  if (output.length > 0 && isDuplicateToolLoopPlaceholder(output)) {
    findings.push(finding('high', 'Step repeated an identical successful tool call without producing substantive output.', options.step.id));
  }
  if (options.result.outputType === 'files' && output.length === 0 && (options.result.filesCreated?.length ?? 0) === 0) {
    findings.push(finding('high', 'file-output step completed without usable output or file evidence.', options.step.id));
  }
  if (requiresWorkspaceChange(options.step.agent) && (options.result.filesCreated?.length ?? 0) === 0) {
    findings.push(finding('medium', 'file-output implementation step did not produce observed workspace file changes.', options.step.id));
  }

  if (options.step.agent === 'adviser' && !options.step.parentStepId && output.includes('adviser-workflow')) {
    const workflow = parseAdviserWorkflow(output);
    if (!workflow) {
      findings.push(finding('high', 'Invalid adviser workflow JSON; cannot safely mutate the DAG.', options.step.id));
    }
  }

  if (options.step.agent === 'grammar-spelling-specialist') {
    findings.push(...validateGrammarPreservation(options));
  }

  if (options.step.agent === 'output-formatter') {
    findings.push(...validateFormatterPreservation(options));
  }

  if (options.step.agent === 'usage-classification-fact-checker' || options.step.agent === 'research-fact-checker') {
    findings.push(...validateFactCheckVerdict(options));
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

function isProtocolAcknowledgment(output: string): boolean {
  const normalized = output.toLowerCase().replace(/\s+/g, ' ').trim();
  const protocolSignals = [
    /\bi am ready to act as\b/,
    /\bi will (?:now )?(?:evaluate|follow|adhere to|execute) (?:incoming )?(?:specifications|the protocol|my role)/,
    /\bmy role is to\b/,
    /\bas the [a-z0-9 -]+ agent\b/,
    /\brole and protocol\b/,
    /\bawait(?:ing)? (?:the )?(?:task|specification|input)\b/,
  ];
  if (!protocolSignals.some((pattern) => pattern.test(normalized))) return false;
  const substantiveSignals = [
    /\b(changed files?|files changed|created|modified|implemented|tests? run|verification|adviser-workflow|plan":|diff|patch)\b/,
  ];
  return !substantiveSignals.some((pattern) => pattern.test(normalized));
}

function isDuplicateToolLoopPlaceholder(output: string): boolean {
  return output.includes('already returned the same successful result for identical parameters');
}


function requiresWorkspaceChange(agent: string): boolean {
  return new Set([
    'implementation-coder',
    'software-delivery',
    'tdd-engineer',
    'docs-maintainer',
    'refactor-cleaner',
    'test-stabilizer',
  ]).has(agent);
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
    findings.push(finding('medium', 'Grammar-polished output changed length too much; possible summary, expansion, or tone/message change.', options.step.id));
  }

  const missingTerms = protectedTerms(source).filter((term) => !output.includes(term));
  if (missingTerms.length > 0) {
    findings.push(finding('medium', `Grammar-polished output dropped protected terms: ${missingTerms.slice(0, 5).join(', ')}`, options.step.id));
  }

  if (countMarkdownStructure(source) !== countMarkdownStructure(output)) {
    findings.push(finding('medium', 'Grammar-polished output changed Markdown/list structure.', options.step.id));
  }

  return findings;
}



function validateFactCheckVerdict(options: HandoffValidationOptions): HandoffFinding[] {
  const output = options.result.output?.trim() ?? '';
  const verdict = /fact-check verdict:\s*([^\n]+)/i.exec(output)?.[1]?.toLowerCase().trim() ?? '';
  if (!verdict) {
    return [finding('high', 'Fact-checker did not provide a required Fact-check verdict.', options.step.id)];
  }
  if (verdict.startsWith('rejected')) {
    return [finding('high', `Fact-checker rejected source report: ${firstNonEmptyLineAfterVerdict(output)}`, options.step.id)];
  }
  if (verdict.startsWith('needs-review')) {
    return [finding('medium', `Fact-checker marked source report as needs-review: ${firstNonEmptyLineAfterVerdict(output)}`, options.step.id)];
  }
  if (!verdict.startsWith('supported')) {
    return [finding('high', `Fact-checker returned unsupported verdict label: ${verdict}`, options.step.id)];
  }
  return [];
}

function firstNonEmptyLineAfterVerdict(output: string): string {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('|') && !/^[-: ]+$/.test(line)) ?? 'no rationale supplied';
}

function validateFormatterPreservation(options: HandoffValidationOptions): HandoffFinding[] {
  const source = combinedDependencyOutput(options.step, options.priorResults);
  const output = options.result.output?.trim() ?? '';
  if (!source || !output) return [];

  const findings: HandoffFinding[] = [];
  const missingLabels = requiredFormatterLabels(source).filter((label) => !formatterLabelPreserved(output, label));
  if (missingLabels.length > 0) {
    findings.push(finding('high', `Formatter dropped required sections or labels: ${missingLabels.slice(0, 6).join(', ')}`, options.step.id));
  }

  const missingTerms = protectedTerms(source).filter((term) => !output.includes(term));
  if (missingTerms.length > 0) {
    findings.push(finding('high', `Formatter dropped protected terms: ${missingTerms.slice(0, 6).join(', ')}`, options.step.id));
  }

  const sourceTokens = new Set(tokenize(source).filter((token) => token.length >= 5));
  const outputTokens = new Set(tokenize(output));
  const missingTokenCount = [...sourceTokens].filter((token) => !outputTokens.has(token)).length;
  if (
    sourceTokens.size >= 12 &&
    missingTokenCount / sourceTokens.size > 0.45 &&
    !isConcisePresentationTask(options.step.task, output)
  ) {
    findings.push(finding('high', 'Formatter dropped too much substantive content from the source output.', options.step.id));
  }

  return findings;
}

function formatterLabelPreserved(output: string, label: string): boolean {
  if (containsLoose(output, label)) return true;

  const alternatives: Record<string, string[]> = {
    'Taxonomy Tree': ['Chemical Taxonomy', 'Taxonomy Classification', 'Taxonomy'],
    'Usage Tree': ['Usage Classification Tree', 'Usage Classification', 'Usage'],
    'Source method': ['Taxonomy Source', 'Usage Source', 'Source/Confidence', 'Source'],
    'Caveat': ['Notes/Caveats', 'Notes', 'Caveats'],
  };

  return (alternatives[label] ?? []).some((alternative) => containsLoose(output, alternative));
}

function isConcisePresentationTask(task: string, output: string): boolean {
  const presentationTask = /\b(xls|cell|presentation|concise|compact)\b/i.test(task);
  const structuredOutput = /\|.+\|/.test(output) || /<br\s*\/?>/i.test(output);
  return presentationTask && structuredOutput;
}

function requiredFormatterLabels(source: string): string[] {
  const labels = [
    'Usage Classification Tree',
    'ClassyFire',
    'ChemOnt',
    'Taxonomy Tree',
    'Usage Tree',
    'Tree 1',
    'Tree 2',
    'Notes',
    'Source method',
    'Confidence',
    'Caveat',
  ];
  return labels.filter((label) => containsLoose(source, label));
}

function containsLoose(text: string, needle: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return normalize(text).includes(normalize(needle));
}

function combinedDependencyOutput(step: DAGStep, priorResults: Map<string, StepResult>): string | null {
  const outputs = step.dependsOn
    .map((dep) => priorResults.get(dep)?.output?.trim())
    .filter((output): output is string => Boolean(output));
  return outputs.length > 0 ? outputs.join('\n\n') : null;
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
