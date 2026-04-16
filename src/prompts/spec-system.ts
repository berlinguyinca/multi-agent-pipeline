import type { FeedbackLoop } from '../types/spec.js';
import { withAgentConduct } from '../utils/agent-conduct.js';

export function buildSpecPrompt(userPrompt: string, feedback?: FeedbackLoop): string {
  const base = `You are a software specification writer. Your task is to create a clear, detailed specification from a user's idea.

Generate a structured specification in markdown with the following sections:

## Goal
A clear, one-paragraph description of what needs to be built.

## Constraints
A bulleted list of technical constraints and requirements.

## Non-Goals
Explicitly list what is NOT in scope.

## Acceptance Criteria
A checklist (using - [ ] format) of specific, testable criteria that define when the project is complete. Each criterion should be concrete enough to write a test for.

## Technical Approach
Brief description of the recommended implementation approach.

User's request:
${userPrompt}`;

  if (feedback) {
    return withAgentConduct(`${base}

IMPORTANT: This is iteration ${feedback.iteration + 1} of the specification. The previous version had issues. Here is the user's feedback to incorporate:

${feedback.feedbackText}

Rewrite the entire specification from scratch, incorporating this feedback. Do not reference the previous version. Produce a complete, standalone specification.`);
  }

  return withAgentConduct(base);
}
