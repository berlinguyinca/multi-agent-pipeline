export interface Spec {
  content: string;
  version: number;
  createdAt: Date;
  acceptanceCriteria: string[];
}

export interface ReviewAnnotation {
  type: 'improvement' | 'warning' | 'approval';
  text: string;
}

export interface ReviewedSpec {
  content: string;
  version: number;
  annotations: ReviewAnnotation[];
  originalSpecVersion: number;
}

export interface RefinementScore {
  iteration: number;
  score: number;
  completeness: number;
  testability: number;
  specificity: number;
  timestamp: Date;
}

export interface FeedbackLoop {
  feedbackText: string;
  iteration: number;
  previousSpecVersion: number;
}

export interface ExecutionResult {
  success: boolean;
  testsTotal: number;
  testsPassing: number;
  testsFailing: number;
  filesCreated: string[];
  outputDir: string;
  duration: number;
}

export function createSpec(content: string, version = 1): Spec {
  const criteria = extractAcceptanceCriteria(content);
  return { content, version, createdAt: new Date(), acceptanceCriteria: criteria };
}

export function extractAcceptanceCriteria(content: string): string[] {
  const lines = content.split('\n');
  return lines
    .filter((line) => /^\s*-\s*\[[ x]\]/.test(line))
    .map((line) => line.replace(/^\s*-\s*\[[ x]\]\s*/, '').trim());
}

export function isValidRefinementScore(score: RefinementScore): boolean {
  return (
    score.score >= 0 &&
    score.score <= 100 &&
    score.completeness >= 0 &&
    score.completeness <= 1 &&
    score.testability >= 0 &&
    score.testability <= 1 &&
    score.specificity >= 0 &&
    score.specificity <= 1 &&
    score.iteration >= 1
  );
}
