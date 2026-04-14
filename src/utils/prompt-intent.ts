const RESEARCH_CUES = [
  /\bwhat is\b/i,
  /\bwhat are\b/i,
  /\bwhy\b/i,
  /\bhow\b/i,
  /\bwho\b/i,
  /\bwhen\b/i,
  /\bwhere\b/i,
  /\bwhich\b/i,
  /\btell me\b/i,
  /\bexplain\b/i,
  /\bsummar(?:ize|ise)\b/i,
  /\bcompare\b/i,
  /\banaly[sz]e\b/i,
  /\bdescribe\b/i,
  /\bresearch\b/i,
  /\bused in\b/i,
  /\bused for\b/i,
] as const;

const BUILD_CUES = [
  /\bbuild\b/i,
  /\bimplement\b/i,
  /\bcreate\b/i,
  /\bwrite\b/i,
  /\badd\b/i,
  /\bfix\b/i,
  /\brefactor\b/i,
  /\bdevelop\b/i,
  /\bscaffold\b/i,
  /\bprototype\b/i,
  /\bship\b/i,
  /\bcode\b/i,
] as const;

export function shouldUseResearchFlow(prompt: string, githubIssueUrl?: string): boolean {
  if (githubIssueUrl?.trim()) {
    return false;
  }

  const normalized = prompt.trim();
  if (!normalized) {
    return false;
  }

  const hasResearchCue = RESEARCH_CUES.some((pattern) => pattern.test(normalized));
  if (!hasResearchCue) {
    return false;
  }

  const hasBuildCue = BUILD_CUES.some((pattern) => pattern.test(normalized));
  return !hasBuildCue;
}
