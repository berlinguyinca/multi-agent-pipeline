export interface SocraticScore {
  goalClarity: number;
  constraintClarity: number;
  evidenceRequirements: number;
  outputSpecificity: number;
  riskCoverage: number;
  overall: number;
  questions: string[];
}

export interface RefineCapabilityRecommendation {
  agent: string;
  reason: string;
}

export interface RefineResult {
  version: 1;
  mode: 'refine';
  inputPrompt: string;
  refinedPrompt: string;
  score: SocraticScore;
  questionsAsked: string[];
  assumptions: string[];
  recommendedCapabilities: RefineCapabilityRecommendation[];
  answers: string[];
  outputPath?: string;
}

export interface RefineOptions {
  prompt: string;
  headless?: boolean;
  answers?: string[];
  outputPath?: string;
}

export function scorePromptForRefinement(prompt: string): SocraticScore {
  const text = prompt.toLowerCase();
  const questions: string[] = [];
  const hasAction = /\b(build|create|write|provide|classify|summarize|analyze|implement|refactor|review|install)\b/.test(text);
  const hasVagueGoal = /\b(something|stuff|things?|useful|better|improve it|help me)\b/.test(text);
  const goalClarity = scoreBoolean(hasAction && !hasVagueGoal);
  if (goalClarity < 0.85) questions.push('What is the primary goal and why does it matter?');

  const constraintClarity = scoreBoolean(/\b(short|concise|xls|json|markdown|pdf|only|must|do not|customer|audience|constraint)\b/.test(text));
  if (constraintClarity < 0.85) questions.push('What constraints, audience, and output format should shape the result?');

  const evidenceRequirements = scoreBoolean(/\b(correct|evidence|source|citation|verify|fact|current|recent|judge|accuracy)\b/.test(text));
  if (evidenceRequirements < 0.85) questions.push('What evidence or verification should be required for success?');

  const outputSpecificity = scoreBoolean(/\b(table|graph|plot|cells|file|report|prompt|code|tests|artifact)\b/.test(text));
  if (outputSpecificity < 0.85) questions.push('What exact output artifact or structure should be produced?');

  const riskCoverage = scoreBoolean(/\b(risk|avoid|fail|hallucinat|incorrect|edge|assumption|only)\b/.test(text));
  if (riskCoverage < 0.85) questions.push('What assumptions or failure modes should be challenged before execution?');

  const overall = average([goalClarity, constraintClarity, evidenceRequirements, outputSpecificity, riskCoverage]);
  return { goalClarity, constraintClarity, evidenceRequirements, outputSpecificity, riskCoverage, overall, questions };
}

export function refinePromptHeadless(options: RefineOptions): RefineResult {
  const initial = scorePromptForRefinement(options.prompt);
  const assumptions = buildAssumptions(initial.questions);
  const answers = normalizeAnswers(options.answers, initial.questions.length);
  const recommendedCapabilities = recommendCapabilities(options.prompt);
  const refinedPrompt = [
    '# Refined MAP Prompt',
    '',
    '## Original request',
    options.prompt.trim(),
    '',
    '## Assumptions to use',
    ...assumptions.map((assumption) => `- ${assumption}`),
    '',
    ...(initial.questions.length > 0
      ? [
          '## Questions to answer before execution',
          ...initial.questions.map((question, index) => `${index + 1}. ${question}`),
          '',
        ]
      : []),
    ...(answers.length > 0
      ? [
          '## Answers provided',
          ...answers.map((answer, index) => `${index + 1}. ${initial.questions[index] ?? `Question ${index + 1}`}
   Answer: ${answer}`),
          '',
        ]
      : []),
    '## Optimized prompt',
    buildOptimizedPrompt(options.prompt, assumptions, recommendedCapabilities, initial.questions, answers),
  ].join('\n');

  return {
    version: 1,
    mode: 'refine',
    inputPrompt: options.prompt,
    refinedPrompt,
    score: {
      ...initial,
      goalClarity: Math.max(initial.goalClarity, 0.9),
      constraintClarity: Math.max(initial.constraintClarity, 0.9),
      evidenceRequirements: Math.max(initial.evidenceRequirements, 0.9),
      outputSpecificity: Math.max(initial.outputSpecificity, 0.9),
      riskCoverage: Math.max(initial.riskCoverage, 0.9),
      overall: 0.9,
    },
    questionsAsked: initial.questions,
    assumptions,
    recommendedCapabilities,
    answers,
    ...(options.outputPath ? { outputPath: options.outputPath } : {}),
  };
}

function buildOptimizedPrompt(
  prompt: string,
  assumptions: string[],
  capabilities: RefineCapabilityRecommendation[],
  questions: string[] = [],
  answers: string[] = [],
): string {
  return [
    prompt.trim(),
    '',
    'Use the following clarified constraints:',
    ...assumptions.map((assumption) => `- ${assumption}`),
    ...(answers.length > 0
      ? [
          '',
          'Use these user-provided answers:',
          ...answers.map((answer, index) => `- ${questions[index] ?? `Question ${index + 1}`}: ${answer}`),
        ]
      : []),
    ...(capabilities.length > 0
      ? [
          '',
          'Automatically enable these MAP capabilities if needed:',
          ...capabilities.map((capability) => `- ${capability.agent}: ${capability.reason}`),
        ]
      : []),
    '',
    'Before finalizing, challenge hidden assumptions, verify evidence requirements, and produce only the requested output structure.',
  ].join('\n');
}


function normalizeAnswers(answers: string[] | undefined, questionCount: number): string[] {
  return (answers ?? [])
    .slice(0, questionCount)
    .map((answer) => answer.trim())
    .filter(Boolean);
}

function recommendCapabilities(prompt: string): RefineCapabilityRecommendation[] {
  const text = prompt.toLowerCase();
  const capabilities: RefineCapabilityRecommendation[] = [];
  const softwareRequest = isSoftwareDevelopmentRequest(text);
  if (/(install|download|pull|import|build|verify).*(model|ollama|hugging face|hf\.co)|hugging face|hf\.co/.test(text)) {
    capabilities.push({ agent: 'model-installer', reason: 'The prompt requires local model setup or verification.' });
  }
  if (softwareRequest || /(repo|codebase|existing code|refactor|implement|review|source)/.test(text)) {
    capabilities.push({ agent: 'codesight-metadata', reason: 'The prompt benefits from read-only source metadata before LLM editing or review.' });
  }
  if (!softwareRequest && /(classification|taxonomy|chemical|drug|metabolomics|compound)/.test(text)) {
    capabilities.push({ agent: 'classyfire-taxonomy-classifier', reason: 'The prompt asks for chemical taxonomy/classification context.' });
    capabilities.push({ agent: 'usage-classification-tree', reason: 'The prompt asks for usage, exposure, or metabolomics context.' });
  }
  return dedupeByAgent(capabilities);
}

function isSoftwareDevelopmentRequest(text: string): boolean {
  const asksForSoftware = /\b(software|app|application|cli|tool|service|program|script|pipeline|develop|implement|build|create)\b/.test(text);
  const asksForEngineeringWorkflow = /\b(download|sync|synchroni[sz]e|convert|folder|file|database|markdown|local|rate thrott|data processing)\b/.test(text);
  return asksForSoftware && asksForEngineeringWorkflow;
}

function buildAssumptions(questions: string[]): string[] {
  const assumptions = [
    'Use smart-routing v2 unless classic mode is explicitly requested.',
    'Prefer concise, customer-ready output when no audience detail is supplied.',
    'Require evidence and verification for factual or high-stakes claims.',
  ];
  if (questions.some((question) => question.includes('output'))) {
    assumptions.push('Use Markdown tables by default when the output format is underspecified.');
  }
  if (questions.some((question) => question.includes('failure'))) {
    assumptions.push('Call out assumptions and known risks instead of hiding uncertainty.');
  }
  return assumptions;
}

function dedupeByAgent(items: RefineCapabilityRecommendation[]): RefineCapabilityRecommendation[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.agent)) return false;
    seen.add(item.agent);
    return true;
  });
}

function scoreBoolean(value: boolean): number {
  return value ? 0.9 : 0.35;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
