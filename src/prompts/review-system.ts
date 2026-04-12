export function buildReviewPrompt(specContent: string): string {
  return `You are a senior software architect reviewing a specification. Your job is to:

1. Evaluate the spec for completeness, testability, and clarity
2. Identify missing requirements, edge cases, or ambiguities
3. Produce an improved version of the specification

First, list your findings as annotations:
- Use "IMPROVEMENT:" prefix for suggested enhancements
- Use "WARNING:" prefix for potential issues
- Use "APPROVAL:" prefix for things that are well-specified

Then produce a complete, improved specification that addresses all findings. The improved spec should be a standalone document (not a diff).

Score the specification on three dimensions (0.0 to 1.0):
- Completeness: Are all requirements captured?
- Testability: Can each acceptance criterion be verified with a test?
- Specificity: Are requirements concrete enough to implement without guessing?

Format your scores as:
SCORES: completeness=X.X testability=X.X specificity=X.X

Here is the specification to review:

${specContent}`;
}
