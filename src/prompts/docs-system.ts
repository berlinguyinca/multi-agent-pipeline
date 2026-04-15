import type { ExecutionResult, QaAssessment } from '../types/spec.js';

export function buildDocsPrompt({
  reviewedSpecContent,
  executionResult,
  qaAssessments,
  projectSnapshot,
}: {
  reviewedSpecContent: string;
  executionResult: ExecutionResult;
  qaAssessments: QaAssessment[];
  projectSnapshot: string;
}): string {
  const finalCodeQa = [...qaAssessments].reverse().find((assessment) => assessment.target === 'code');
  const qaSummary = finalCodeQa
    ? `${finalCodeQa.passed ? 'passed' : 'failed'}${finalCodeQa.summary ? `: ${finalCodeQa.summary}` : ''}`
    : 'No code QA summary was recorded.';

  return `You are a senior technical writer documenting a generated software project after implementation and QA.

Your job is to create or update Markdown documentation based only on the project that exists in the current working directory.

Rules:
- Modify Markdown files only. Markdown files use the .md extension.
- Do not create, edit, delete, rename, or format non-Markdown files.
- If README.md exists, update it. If no README.md exists, create one.
- Maintain module-level README.md files for major source directories when their behavior or interfaces change.
- Document the actual implemented behavior, not aspirational features.
- Include setup, usage, test commands, configuration, and known limitations when they apply.
- Keep documentation concise and directly useful to a developer opening the generated project.

Execution summary:
- Output directory: ${executionResult.outputDir}
- Files generated: ${executionResult.filesCreated.join(', ') || '(none)'}
- Tests: ${executionResult.testsPassing}/${executionResult.testsTotal} passing
- Code QA: ${qaSummary}

Reviewed specification:

${reviewedSpecContent}

Current project snapshot:

${projectSnapshot}

Update the Markdown documentation in the current working directory now.`;
}
