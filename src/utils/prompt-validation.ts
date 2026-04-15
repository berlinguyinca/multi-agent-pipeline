const MIN_WORDS = 10;

export interface PromptValidationResult {
  valid: boolean;
  error?: string;
}

export interface PromptValidationOptions {
  allowPromptWithSpecFile?: boolean;
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
  specFilePath?: string,
  options: PromptValidationOptions = {},
): PromptValidationResult {
  const hasGitHubIssue = Boolean(githubIssueUrl && githubIssueUrl.trim().length > 0);
  const hasSpecFile = Boolean(specFilePath && specFilePath.trim().length > 0);
  const hasPrompt = prompt.trim().length > 0;

  if (hasGitHubIssue && hasSpecFile) {
    return {
      valid: false,
      error: 'Choose exactly one primary input source. Do not combine --github-issue with --spec-file.',
    };
  }

  if (hasSpecFile && hasPrompt && !options.allowPromptWithSpecFile) {
    return {
      valid: false,
      error: 'Choose exactly one primary input source. Do not combine prompt text with --spec-file.',
    };
  }

  // GitHub issue URL provides its own context — skip word count check
  if (hasGitHubIssue || hasSpecFile) {
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
