// src/router/prompt-builder.ts
import type { AgentDefinition } from '../types/agent-definition.js';

export function buildRouterPrompt(
  agents: Map<string, AgentDefinition>,
  userTask: string,
  maxSteps = 10,
): string {
  const agentDescriptions = [...agents.entries()]
    .map(([name, agent]) =>
      `- **${name}**: ${agent.description}. Handles: ${agent.handles}. Output: ${agent.output.type}.`,
    )
    .join('\n');

  const cleanTask = sanitizeRouterTask(userTask);

  return `You are a task router. Analyze the user's task and create an execution plan using the available agents.

## Available Agents

${agentDescriptions}

## User Task

${cleanTask}

## Instructions

1. Decide which agent(s) are needed for this task.
2. If the task requires multiple agents, break it into steps with dependencies.
3. Steps with no dependencies on each other can run in parallel (use empty dependsOn).
4. Use at most ${maxSteps} steps.
5. Each step's "task" field should be a clear, scoped sub-task description for that agent.
6. Only use agent names from the list above.
7. If no listed agent is a good fit, do NOT force a bad match. Return a no-match result instead.

## Output Format

Respond with ONLY valid JSON, no markdown fences, no explanation, and no thinking text:

{"kind":"plan","plan":[{"id":"step-1","agent":"<agent-name>","task":"<sub-task description>","dependsOn":[]},{"id":"step-2","agent":"<agent-name>","task":"<sub-task description>","dependsOn":["step-1"]}]}

or

{"kind":"no-match","reason":"<why no existing agent fits>","suggestedAgent":{"name":"<short-kebab-name>","description":"<what the missing agent should handle>"}}`;
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
