import type { AgentAdapter } from '../types/adapter.js';
import type { RefineCapabilityRecommendation, RefineQuestion } from './refiner.js';

export function buildRefineQuestionPrompt(options: {
  prompt: string;
  heuristicQuestions: string[];
  recommendedCapabilities: RefineCapabilityRecommendation[];
}): string {
  return [
    'You generate concise Socratic refinement questions for MAP before execution.',
    'Ask only questions whose answers are not already present in the request.',
    'Make questions specific to the user task, not generic project-management questions.',
    'Include at least one question that helps define the task-specific definition of done or observable success conditions.',
    'Prefer 3 to 6 questions. Each question should explain why it matters and include a safe default assumption if unanswered.',
    '',
    'Return ONLY JSON with this shape:',
    '{"questions":[{"question":"specific question","reason":"why it matters","defaultAssumption":"safe assumption if unanswered"}]}',
    '',
    'Original request:',
    options.prompt,
    '',
    'Heuristic fallback questions:',
    ...options.heuristicQuestions.map((question) => `- ${question}`),
    '',
    'Detected MAP capabilities:',
    ...(options.recommendedCapabilities.length > 0
      ? options.recommendedCapabilities.map((capability) => `- ${capability.agent}: ${capability.reason}`)
      : ['- none']),
  ].join('\n');
}

export async function generateRefineQuestions(options: {
  adapter: AgentAdapter;
  prompt: string;
  heuristicQuestions: string[];
  recommendedCapabilities: RefineCapabilityRecommendation[];
}): Promise<RefineQuestion[]> {
  const prompt = buildRefineQuestionPrompt(options);
  let output = '';
  for await (const chunk of options.adapter.run(prompt, {
    responseFormat: 'json',
    hideThinking: true,
    think: false,
  })) {
    output += chunk;
  }
  return parseRefineQuestionResponse(output);
}

export function parseRefineQuestionResponse(output: string): RefineQuestion[] {
  const parsed = parseFirstJsonObject(output);
  const rawQuestions = Array.isArray(parsed?.['questions']) ? parsed['questions'] : [];
  return rawQuestions
    .map((entry): RefineQuestion | null => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      const question = typeof record['question'] === 'string' ? record['question'].trim() : '';
      if (!question) return null;
      const reason = typeof record['reason'] === 'string' ? record['reason'].trim() : undefined;
      const defaultAssumption = typeof record['defaultAssumption'] === 'string'
        ? record['defaultAssumption'].trim()
        : undefined;
      return {
        question,
        ...(reason ? { reason } : {}),
        ...(defaultAssumption ? { defaultAssumption } : {}),
      };
    })
    .filter((entry): entry is RefineQuestion => entry !== null)
    .slice(0, 6);
}

function parseFirstJsonObject(output: string): Record<string, unknown> | null {
  for (let start = output.indexOf('{'); start !== -1; start = output.indexOf('{', start + 1)) {
    for (let end = output.length; end > start; end -= 1) {
      const candidate = output.slice(start, end).trim();
      if (!candidate.endsWith('}')) continue;
      try {
        const parsed = JSON.parse(candidate) as unknown;
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : null;
      } catch {
        continue;
      }
    }
  }
  return null;
}
