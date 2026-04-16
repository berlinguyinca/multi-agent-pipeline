import type { ExecutionResult } from '../types/spec.js';
import { withAgentConduct } from '../utils/agent-conduct.js';

const QA_OUTPUT_FORMAT = `Return your verdict using this exact marker format:
QA_RESULT: pass|fail
SUMMARY: one concise paragraph
FINDING: concrete issue or strength
REQUIRED_CHANGE: required change when failing

Use multiple FINDING and REQUIRED_CHANGE lines when needed.`;

export function buildSpecQaPrompt(originalPrompt: string, reviewedSpecContent: string): string {
  return withAgentConduct(`You are a senior QA architect assessing whether a software specification is ready for implementation.

Evaluate the spec for completeness, behavioral clarity, testability, edge cases, and common engineering best practices. Fail the assessment if the implementer would need to guess important behavior or if acceptance criteria are not testable.

Original user request:
${originalPrompt}

Reviewed specification:
${reviewedSpecContent}

${QA_OUTPUT_FORMAT}`);
}

export function buildCodeQaPrompt(
  reviewedSpecContent: string,
  executionResult: ExecutionResult,
  projectSnapshot: string,
): string {
  return withAgentConduct(`You are a senior QA engineer assessing generated software against an approved specification.

Evaluate behavior, tests, maintainability, README accuracy, source organization, and adherence to common coding practices. Fail the assessment when required behavior is missing, tests are weak, implementation is brittle, or the project diverges from the spec.

Approved specification:
${reviewedSpecContent}

Execution summary:
- Output directory: ${executionResult.outputDir}
- Files created: ${executionResult.filesCreated.join(', ') || '(none)'}
- Tests passing: ${executionResult.testsPassing}/${executionResult.testsTotal}
- Tests failing: ${executionResult.testsFailing}

Generated project snapshot:
${projectSnapshot}

${QA_OUTPUT_FORMAT}`);
}

export function buildCodeFixPrompt(
  reviewedSpecContent: string,
  qaSummary: string,
  outputDir: string,
): string {
  return withAgentConduct(`You are a senior software developer fixing an existing generated project after QA review.

Modify the project in the current working directory only. Do not write files outside this directory. Preserve the approved specification, improve behavior and code quality, and run/update tests as needed.

Approved specification:
${reviewedSpecContent}

QA findings to address:
${qaSummary}

Project directory:
${outputDir}

Return concise progress output and include test markers when tests are written or pass:
// [TEST:WRITE] <test-name>
// [TEST:PASS] <test-name>
// [TEST:FAIL] <test-name>`);
}
