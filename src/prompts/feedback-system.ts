import { withAgentConduct } from '../utils/agent-conduct.js';

export function buildFeedbackPrompt(
  originalPrompt: string,
  specContent: string,
  reviewContent: string,
  feedbackText: string,
): string {
  return withAgentConduct(`You are a software specification writer revising a specification based on user feedback.

Original user request:
${originalPrompt}

Previous specification:
${specContent}

Reviewer's assessment:
${reviewContent}

User's feedback for this revision:
${feedbackText}

Rewrite the entire specification from scratch, incorporating the user's feedback. Produce a complete, standalone specification. Do not reference the previous version. Use the same format:

## Goal
## Constraints
## Non-Goals
## Acceptance Criteria (using - [ ] checkboxes)
## Technical Approach`);
}
