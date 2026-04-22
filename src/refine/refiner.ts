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

export interface RefineQuestion {
  question: string;
  reason?: string;
  defaultAssumption?: string;
}

export interface RefineResult {
  version: 1;
  mode: 'refine';
  inputPrompt: string;
  refinedPrompt: string;
  score: SocraticScore;
  questionsAsked: string[];
  questionDetails: RefineQuestion[];
  successQuestionsAsked: string[];
  successQuestionDetails: RefineQuestion[];
  assumptions: string[];
  successCriteria: string[];
  recommendedCapabilities: RefineCapabilityRecommendation[];
  answers: string[];
  successAnswers: string[];
  outputPath?: string;
}

export interface RefineOptions {
  prompt: string;
  headless?: boolean;
  answers?: string[];
  successAnswers?: string[];
  questionDetails?: RefineQuestion[];
  outputPath?: string;
}

export function scorePromptForRefinement(prompt: string): SocraticScore {
  const text = prompt.toLowerCase();
  if (isPubChemSoftwareSyncRequest(text)) {
    return {
      goalClarity: 0.9,
      constraintClarity: 0.65,
      evidenceRequirements: 0.65,
      outputSpecificity: 0.65,
      riskCoverage: 0.65,
      overall: 0.7,
      questions: [
        'Which PubChem distribution source should be authoritative: FTP bulk dumps, PUG-REST, PUG-View, or another endpoint?',
        'Should the sync cover full PubChem compound/substance bulk dumps, selected file types, or filtered subsets?',
        'What Markdown output layout is required: one file per source record, one file per downloaded archive, or indexes plus raw archives?',
        'What local sync policy should be used for deletes, resumable partial downloads, checksums, and versioned snapshots?',
      ],
    };
  }

  const questions: string[] = [];
  const hasAction = /\b(build|create|write|provide|classify|summarize|analyze|implement|refactor|review|install|develop|require|need|download|sync|synchroni[sz]e|convert)\b/.test(text);
  const hasVagueGoal = /\b(something|stuff|things?|useful|better|improve it|help me)\b/.test(text);
  const goalClarity = scoreBoolean(hasAction && !hasVagueGoal);
  if (goalClarity < 0.85) questions.push('What is the primary goal and why does it matter?');

  const constraintClarity = scoreBoolean(/\b(short|concise|xls|json|markdown|pdf|only|must|do not|customer|audience|constraint)\b/.test(text));
  if (constraintClarity < 0.85) questions.push('What constraints, audience, and output format should shape the result?');

  const evidenceRequirements = scoreBoolean(/\b(correct|evidence|source|citation|verify|fact|current|recent|judge|accuracy)\b/.test(text));
  if (evidenceRequirements < 0.85) questions.push('What evidence or verification should be required for success?');

  const outputSpecificity = scoreBoolean(/\b(table|graph|plot|cells|file|report|prompt|code|tests|artifact|markdown)\b/.test(text));
  if (outputSpecificity < 0.85) questions.push('What exact output artifact or structure should be produced?');

  const riskCoverage = scoreBoolean(/\b(risk|avoid|fail|hallucinat|incorrect|edge|assumption|only|rate thrott|backoff|resume)\b/.test(text));
  if (riskCoverage < 0.85) questions.push('What assumptions or failure modes should be challenged before execution?');

  const overall = average([goalClarity, constraintClarity, evidenceRequirements, outputSpecificity, riskCoverage]);
  return { goalClarity, constraintClarity, evidenceRequirements, outputSpecificity, riskCoverage, overall, questions };
}


export function refinePromptHeadless(options: RefineOptions): RefineResult {
  const initial = scorePromptForRefinement(options.prompt);
  const questionDetails = normalizeQuestionDetails(options.questionDetails, initial.questions);
  const questions = questionDetails.map((entry) => entry.question);
  const assumptions = buildAssumptions(questions);
  const answers = normalizeAnswers(options.answers, questions.length);
  const successQuestionDetails = buildSuccessQuestionDetails(options.prompt, questionDetails, answers);
  const successQuestions = successQuestionDetails.map((entry) => entry.question);
  const successAnswers = normalizeAnswers(options.successAnswers, successQuestions.length);
  const successCriteria = buildSuccessCriteria(options.prompt, answers, successAnswers);
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
    ...(questionDetails.length > 0
      ? [
          '## Questions to answer before execution',
          ...questionDetails.flatMap((entry, index) => [
            `${index + 1}. ${entry.question}`,
            ...(entry.reason ? [`   Why it matters: ${entry.reason}`] : []),
            ...(entry.defaultAssumption ? [`   Default if unanswered: ${entry.defaultAssumption}`] : []),
          ]),
          '',
        ]
      : []),
    ...(answers.length > 0
      ? [
          '## Answers provided',
          ...answers.map((answer, index) => `${index + 1}. ${questions[index] ?? `Question ${index + 1}`}
   Answer: ${answer}`),
          '',
        ]
      : []),
    '## Follow-up success questions',
    ...successQuestionDetails.flatMap((entry, index) => [
      `${index + 1}. ${entry.question}`,
      ...(entry.reason ? [`   Why it matters: ${entry.reason}`] : []),
      ...(entry.defaultAssumption ? [`   Default if unanswered: ${entry.defaultAssumption}`] : []),
    ]),
    '',
    ...(successAnswers.length > 0
      ? [
          '## Follow-up success answers',
          ...successAnswers.map((answer, index) => `${index + 1}. ${successQuestions[index] ?? `Success question ${index + 1}`}
   Answer: ${answer}`),
          '',
        ]
      : []),
    '## Definition of done',
    ...successCriteria.map((criterion) => `- ${criterion}`),
    '',
    '## Optimized prompt',
    buildOptimizedPrompt(options.prompt, assumptions, recommendedCapabilities, questions, answers, successCriteria),
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
    questionsAsked: questions,
    questionDetails,
    successQuestionsAsked: successQuestions,
    successQuestionDetails,
    assumptions,
    successCriteria,
    recommendedCapabilities,
    answers,
    successAnswers,
    ...(options.outputPath ? { outputPath: options.outputPath } : {}),
  };
}

function buildOptimizedPrompt(
  prompt: string,
  assumptions: string[],
  capabilities: RefineCapabilityRecommendation[],
  questions: string[] = [],
  answers: string[] = [],
  successCriteria: string[] = [],
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
    ...(successCriteria.length > 0
      ? [
          '',
          'Use this definition of done:',
          ...successCriteria.map((criterion) => `- ${criterion}`),
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



function normalizeQuestionDetails(
  details: RefineQuestion[] | undefined,
  fallbackQuestions: string[],
): RefineQuestion[] {
  const normalized = (details ?? [])
    .map((entry) => ({
      question: entry.question.trim(),
      ...(entry.reason?.trim() ? { reason: entry.reason.trim() } : {}),
      ...(entry.defaultAssumption?.trim() ? { defaultAssumption: entry.defaultAssumption.trim() } : {}),
    }))
    .filter((entry) => entry.question.length > 0);
  if (normalized.length > 0) return normalized.slice(0, 6);
  return fallbackQuestions.map((question) => ({ question }));
}

function normalizeAnswers(answers: string[] | undefined, questionCount: number): string[] {
  return (answers ?? [])
    .slice(0, questionCount)
    .map((answer) => answer.trim())
    .filter(Boolean);
}

function buildSuccessQuestionDetails(
  prompt: string,
  questionDetails: RefineQuestion[],
  answers: string[],
): RefineQuestion[] {
  const subject = summarizeTaskSubject(prompt);
  const clarification = summarizeClarifications(questionDetails, answers);
  const clarificationPhrase = clarification ? ` given: ${clarification}` : '';
  return [
    {
      question: `For ${subject}, what 2-3 concrete outcomes define done${clarificationPhrase}?`,
      reason: 'MAP needs explicit success conditions so planning, QA, and release-readiness agents can judge completion instead of guessing.',
      defaultAssumption: `Treat the requested ${subject} artifact as done only when it exists, matches the clarified constraints, and is usable by the intended audience.`,
    },
    {
      question: `What verification evidence should prove ${subject} works end-to-end${clarificationPhrase}?`,
      reason: 'Verification requirements turn “done” into observable tests, commands, files, reports, or evidence checks.',
      defaultAssumption: defaultVerificationAssumption(prompt),
    },
  ];
}

function buildSuccessCriteria(prompt: string, answers: string[], successAnswers: string[]): string[] {
  if (successAnswers.length > 0) return successAnswers;
  const subject = summarizeTaskSubject(prompt);
  const clarification = answers.join('; ');
  return [
    `The requested ${subject} artifact is produced and matches the clarified constraints${clarification ? ` (${clarification})` : ''}.`,
    defaultVerificationAssumption(prompt),
  ];
}

function summarizeTaskSubject(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  if (/\bpubchem\b/i.test(compact)) return 'PubChem task';
  if (/\bhmdb\b/i.test(compact)) return 'HMDB task';
  if (/\bmetabolomics workbench\b/i.test(compact)) return 'Metabolomics Workbench task';
  return compact.length > 90 ? `${compact.slice(0, 87).trimEnd()}...` : compact || 'this task';
}

function summarizeClarifications(questionDetails: RefineQuestion[], answers: string[]): string {
  return answers
    .map((answer, index) => {
      const question = questionDetails[index]?.question;
      return question ? `${question} ${answer}` : answer;
    })
    .join('; ')
    .replace(/\s+/g, ' ')
    .slice(0, 240)
    .trim();
}

function defaultVerificationAssumption(prompt: string): string {
  const text = prompt.toLowerCase();
  if (isSoftwareDevelopmentRequest(text)) {
    return 'Relevant tests pass, a sample or fixture run succeeds, and generated outputs contain actual non-empty data when the task creates files or records.';
  }
  if (isChemicalTaxonomyUsageRequest(text)) {
    return 'The output contains only the requested taxonomy/usage tables and graph plot; every table cell is populated; medical/metabolomics usage and commonness claims are fact-checked against PubMed/NCBI, DrugBank/PubChem/ChEBI/HMDB/KEGG/ChEMBL/MeSH/NCBI, FDA/DailyMed, metabolomics resources, or equivalent authoritative evidence; web-search findings are reviewed as leads by at least three distinct verification perspectives when available; usage evidence is separated from caveats and from commonness evidence, with commonness marked unavailable when prevalence/adoption evidence is missing.';
  }
  return 'Relevant evidence, tests, or review checks are run and their passing results are reported before completion.';
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

function isPubChemSoftwareSyncRequest(text: string): boolean {
  return /\bpubchem\b/.test(text) && isSoftwareDevelopmentRequest(text);
}

function isChemicalTaxonomyUsageRequest(text: string): boolean {
  return /\b(classification|taxonomy|classyfire|chemont)\b/.test(text) &&
    /\b(usage|usages|use|uses|medical|metabolomics|lcb|exposure)\b/.test(text) &&
    /\b(report|table|tables|graph|plot|xls|customer|classification tree|usage tree)\b/.test(text) &&
    !isSoftwareDevelopmentRequest(text);
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
