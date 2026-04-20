// src/router/prompt-builder.ts
import type { AgentDefinition } from '../types/agent-definition.js';
import { buildRoleRoutingSummary } from '../agents/contract-prompt.js';

export function buildRouterPrompt(
  agents: Map<string, AgentDefinition>,
  userTask: string,
  maxSteps = 10,
): string {
  const agentDescriptions = [...agents.entries()]
    .map(([name, agent]) => {
      const roleSummary = buildRoleRoutingSummary(agent.contract);
      const contractText = roleSummary ? ` ${roleSummary}` : '';
      return `- **${name}**: ${agent.description}. Handles: ${agent.handles}. Output: ${agent.output.type}.${contractText}`;
    })
    .join('\n');

  const cleanTask = sanitizeRouterTask(userTask);

  return `You are a task router. Analyze the user's task and create an execution plan using the available agents.

## Available Agents

${agentDescriptions}

## User Task

${cleanTask}

## Instructions

1. Decide which agent(s) are needed for this task.
2. If the task is complex, decompose it into bounded sub-tasks and use multiple agents when that materially improves quality, speed, or correctness.
3. Steps with no dependencies on each other can run in parallel (use empty dependsOn).
4. Use adaptive bounded planning: keep simple tasks compact, but use as many steps as needed up to ${maxSteps} for complex work.
5. Each step's "task" field should be a clear, concise, scoped, non-repetitive sub-task description for that agent. Do not repeat words or phrases to fill space.
6. Only use agent names from the list above.
7. If no listed agent is a good fit, do NOT force a bad match. Return a no-match result instead.
8. Prefer agents with web research capability for tasks that need current external knowledge.
9. Use presentation or visualization-oriented agents when the request asks for decks, charts, diagrams, or polished visual deliverables.
10. For knowledge-heavy tasks, prefer a knowledge-aware plan that can use the shared 2nd brain and knowledge hygiene when stale or external knowledge matters.
11. For high-stakes judgment-heavy tasks, you may plan multiple candidate-producing steps followed by a result-judge step that selects the best outcome. Do not use result-judge to format, summarize, or prepare customer reports; deterministic local renderers produce final Markdown/HTML/PDF output from completed source-agent results.
12. Coding workflows with a reviewed and QA-approved spec must route through adviser before execution agents. The adviser recommends the launch order, parallelization, custom agents to create, and whether the agent list must be refreshed. Adviser may replace pending downstream steps at runtime by returning adviser-workflow JSON.
13. Do not explicitly add grammar-spelling-specialist steps for ordinary text polishing; the orchestrator automatically schedules that specialist after human-facing text outputs.
14. Include a concise rationale object explaining selected agents and notable rejected agents so users can understand and tune the network.
15. For existing-codebase implementation, refactor, review, or architecture tasks, prefer one read-only metadata generator step (insightcode-metadata, codefetch-metadata, or codesight-metadata when available) before LLM editing/review steps when it materially improves codebase understanding. Metadata agents are deterministic and must not modify source files.
16. When a task asks to download, pull, import, build, install, or verify a Hugging Face or Ollama model, route through model-installer when available before any downstream agent that needs the model.
17. For large software tasks, split implementation into bounded slices handled by existing implementation agents instead of one broad file-output step; each slice should have a focused task, clear dependencies, and verification context. Prefer TDD/test-authoring, then implementation-coder/software-delivery slices, then QA/docs.
18. For completed software builds, include legal-license-advisor when available to recommend compatible license options based on utilized languages and libraries before docs-maintainer finalizes license coverage. Then include a post-build docs step when docs-maintainer is available so the delivered tool gets a README explaining what the tool does and how to use the tool, plus LICENSE coverage or an explicit license-choice blocker.

## Output Format

Respond with ONLY valid JSON, no markdown fences, no explanation, and no thinking text:

{"kind":"plan","plan":[{"id":"step-1","agent":"<agent-name>","task":"<sub-task description>","dependsOn":[]},{"id":"step-2","agent":"<agent-name>","task":"<sub-task description>","dependsOn":["step-1"]}],"rationale":{"selectedAgents":[{"agent":"<agent-name>","reason":"<why this agent helps>"}],"rejectedAgents":[{"agent":"<agent-name>","reason":"<why this agent was not needed>"}]}}

or

{"kind":"no-match","reason":"<why no existing agent fits>","suggestedAgent":{"name":"<short-kebab-name>","description":"<what the missing agent should handle>"},"rationale":{"selectedAgents":[],"rejectedAgents":[{"agent":"<agent-name>","reason":"<why this available agent does not fit>"}]}}`;
}

function sanitizeRouterTask(text: string): string {
  const withoutAnsi = text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '');

  const lines = withoutAnsi
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/^[\s│┃┃╭╮╰╯┌┐└┘├┤┬┴┼]+/g, '')
        .replace(/[\s│┃╭╮╰╯┌┐└┘├┤┬┴┼]+$/g, '')
        .trim(),
    )
    .filter((line) => line.length > 0);

  return lines.join('\n');
}
