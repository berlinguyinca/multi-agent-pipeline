const MIN_WORDS = 10;

export interface PromptValidationResult {
  valid: boolean;
  error?: string;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Validates that a prompt has enough context for the pipeline to work with.
 * A GitHub issue URL bypasses validation since the issue body provides context.
 */
export function validatePrompt(
  prompt: string,
  githubIssueUrl?: string,
): PromptValidationResult {
  // GitHub issue URL provides its own context — skip word count check
  if (githubIssueUrl && githubIssueUrl.trim().length > 0) {
    return { valid: true };
  }

  const wordCount = countWords(prompt);
  if (wordCount < MIN_WORDS) {
    return {
      valid: false,
      error: `Prompt too short (${wordCount}/${MIN_WORDS} words). Describe what to build with enough detail for the pipeline to generate a useful spec.`,
    };
  }

  return { valid: true };
}

export { MIN_WORDS };
