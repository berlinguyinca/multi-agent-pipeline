const MIN_WORDS = 10;

export interface PromptValidationResult {
  valid: boolean;
  error?: string;
}

export interface PromptValidationOptions {
  allowPromptWithSpecFile?: boolean;
  youtrackIssueUrl?: string;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Validates that a prompt has enough context for the pipeline to work with.
 * External issue URLs bypass validation since the issue body provides context.
 */
export function validatePrompt(
  prompt: string,
  githubIssueUrl?: string,
  specFilePath?: string,
  options: PromptValidationOptions = {},
): PromptValidationResult {
  const hasValue = (value: string | undefined) => Boolean(value && value.trim().length > 0);
  const hasGitHubIssue = hasValue(githubIssueUrl);
  const hasYouTrackIssue = hasValue(options.youtrackIssueUrl);
  const hasSpecFile = hasValue(specFilePath);
  const hasPrompt = prompt.trim().length > 0;

  const presentSources = [
    { flag: '--github-issue', present: hasGitHubIssue },
    { flag: '--youtrack-issue', present: hasYouTrackIssue },
    { flag: '--spec-file', present: hasSpecFile },
  ].filter((source) => source.present);

  if (presentSources.length > 1) {
    return {
      valid: false,
      error: `Choose exactly one primary input source. Do not combine ${presentSources.map((source) => source.flag).join(', ')}.`,
    };
  }

  if (hasSpecFile && hasPrompt && !options.allowPromptWithSpecFile) {
    return {
      valid: false,
      error: 'Choose exactly one primary input source. Do not combine prompt text with --spec-file.',
    };
  }

  // External issues and spec files provide their own context — skip word count check
  if (hasGitHubIssue || hasYouTrackIssue || hasSpecFile) {
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
