import * as path from 'path';
import * as fs from 'fs/promises';
import { spawnSync } from 'node:child_process';
import * as readline from 'readline/promises';
import type { AgentDefinition } from '../types/agent-definition.js';
import { loadAgentRegistry } from '../agents/registry.js';
import { loadConfig } from '../config/loader.js';
import { generateAndWriteAgentFiles } from './agent-create-dialog.js';
import { createAdapter } from '../adapters/adapter-factory.js';
import { createToolRegistry } from '../tools/registry.js';
import { injectToolCatalog } from '../tools/inject.js';

export async function handleAgentCommand(args: string[]): Promise<void> {
  const action = args[0];
  switch (action) {
    case 'list': await handleList(); break;
    case 'create': {
      const adapterFlag = extractFlagValue(args, '--adapter') ?? undefined;
      const modelFlag = extractFlagValue(args, '--model') ?? undefined;
      await handleCreate(adapterFlag, modelFlag);
      break;
    }
    case 'test': {
      const name = args[1];
      if (!name) { console.error('Usage: map agent test <name>'); process.exit(1); }
      const prompt = extractFlagValue(args, '--prompt') ?? args.slice(2).filter((arg) => !arg.startsWith('--')).join(' ');
      await handleTest(name, prompt);
      break;
    }
    case 'edit': {
      const name = args[1];
      if (!name) { console.error('Usage: map agent edit <name>'); process.exit(1); }
      await handleEdit(name);
      break;
    }
    default: console.log(`Unknown agent command: ${action ?? '(none)'}\n\nUsage:\n  map agent list\n  map agent create\n  map agent test <name> [--prompt "sample task"]\n  map agent edit <name>`); break;
  }
}

function extractFlagValue(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

async function handleCreate(adapterOverride?: string, modelOverride?: string): Promise<void> {
  const config = await loadConfig();
  const adapter = adapterOverride ?? config.agentCreation.adapter;
  const model = modelOverride ?? config.agentCreation.model;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const description = await rl.question('What should this agent do?\n> ');
    if (!description.trim()) {
      console.error('Description cannot be empty.');
      return;
    }
    const suggestedName = await rl.question('What should we call it? Leave blank to let the generator choose.\n> ');
    const adapterAnswer = await rl.question(`Which adapter? Leave blank for ${adapter}.\n> `);
    const modelAnswer = await rl.question(`Which model? Leave blank for ${model ?? 'no model'}.\n> `);
    const toolsAnswer = await rl.question('Does it need tools? Use comma-separated names or [] for none.\n> ');
    const stagesAnswer = await rl.question('What pipeline stages should it use? Use comma-separated names or leave blank for generator choice.\n> ');
    const outputAnswer = await rl.question('What output type? answer, data, files, or blank for generator choice.\n> ');
    const selectedAdapter = adapterAnswer.trim() || adapter;
    const selectedModel = modelAnswer.trim() || model;

    console.log(`\nGenerating agent definition using ${selectedAdapter}/${selectedModel ?? 'default'}...`);

    const files = await generateAndWriteAgentFiles({
      cwd: process.cwd(),
      description,
      adapter: selectedAdapter,
      model: selectedModel,
      preferences: {
        name: suggestedName.trim() || undefined,
        adapter: selectedAdapter,
        model: selectedModel,
        tools: toolsAnswer.trim() || undefined,
        pipeline: stagesAnswer.trim() || undefined,
        outputType: outputAnswer.trim() || undefined,
      },
    });

    console.log(`\nAgent "${files.name}" created at agents/${files.name}/`);
    console.log(`  agent.yaml - configuration`);
    console.log(`  prompt.md  - system prompt`);
    console.log(`\nReview the files, then commit to make it available.`);
  } finally {
    rl.close();
  }
}

async function handleList(): Promise<void> {
  const agentsDir = path.join(process.cwd(), 'agents');
  const agents = await loadAgentRegistry(agentsDir);
  console.log(formatAgentList(agents));
}

async function handleEdit(name: string): Promise<void> {
  const agentDir = path.join(process.cwd(), 'agents', name);
  const promptPath = path.join(agentDir, 'prompt.md');
  try {
    await fs.access(promptPath);
  } catch {
    console.error(`Agent "${name}" not found at ${agentDir}`);
    process.exit(1);
  }

  const editor = process.env['EDITOR'] || process.env['VISUAL'] || 'vi';
  const result = spawnSync(editor, [promptPath], { stdio: 'inherit' });
  if (result.error) {
    console.error(`Failed to launch editor "${editor}": ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 0);
}

async function handleTest(name: string, samplePrompt?: string): Promise<void> {
  const agentsDir = path.join(process.cwd(), 'agents');
  const agents = await loadAgentRegistry(agentsDir);
  const agent = agents.get(name);
  if (!agent) { console.error(`Agent "${name}" not found. Available: ${[...agents.keys()].join(', ') || '(none)'}`); process.exit(1); }
  console.log(`Testing agent "${name}" (${agent.adapter}${agent.model ? '/' + agent.model : ''})...`);
  console.log(`Description: ${agent.description}`);
  console.log(`Handles: ${agent.handles}`);
  console.log(`Pipeline: ${agent.pipeline.map((s) => s.name).join(' → ')}`);
  console.log(`Output: ${agent.output.type}`);
  console.log(`Tools: ${agent.tools.length}`);
  console.log('\nAgent definition is valid. Running sample prompt...\n');

  const adapter = createAdapter({ type: agent.adapter, model: agent.model });
  const tools = createToolRegistry(agent, process.cwd());
  const prompt = buildAgentTestPrompt(agent, samplePrompt);
  const runnablePrompt = injectToolCatalog(prompt, tools, agent.prompt);

  for await (const chunk of adapter.run(runnablePrompt, { cwd: process.cwd(), allowTools: true })) {
    process.stdout.write(chunk);
  }
  process.stdout.write('\n');
}

export function buildAgentTestPrompt(agent: AgentDefinition, samplePrompt?: string): string {
  const task = samplePrompt?.trim() || `Briefly explain how you would handle a task matching: ${agent.handles}`;
  return [
    'This is a MAP agent smoke test.',
    'Respond concisely and do not modify files unless the task explicitly requires it.',
    '',
    `Agent: ${agent.name}`,
    `Declared output type: ${agent.output.type}`,
    '',
    `Sample task: ${task}`,
  ].join('\n');
}

export function formatAgentList(agents: Map<string, AgentDefinition>): string {
  if (agents.size === 0) return 'No agents found. Create one with: map agent create';
  const header = 'Name            Adapter    Model      Output  Pipeline                      Tools';
  const divider = '─'.repeat(header.length);
  const rows = [...agents.entries()].map(([name, agent]) => {
    const pipeline = agent.pipeline.map((s) => s.name).join(' → ');
    return [name.padEnd(16), agent.adapter.padEnd(11), (agent.model ?? '-').padEnd(11), agent.output.type.padEnd(8), pipeline.slice(0, 30).padEnd(30), String(agent.tools.length)].join('');
  });
  return `\n${header}\n${divider}\n${rows.join('\n')}\n`;
}
