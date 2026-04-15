import * as path from 'path';
import * as fs from 'fs/promises';
import * as readline from 'readline/promises';
import type { AgentDefinition } from '../types/agent-definition.js';
import { loadAgentRegistry } from '../agents/registry.js';
import { loadConfig } from '../config/loader.js';
import { generateAndWriteAgentFiles } from './agent-create-dialog.js';

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
      await handleTest(name);
      break;
    }
    default: console.log(`Unknown agent command: ${action ?? '(none)'}\n\nUsage:\n  map agent list\n  map agent create\n  map agent test <name>`); break;
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

    console.log(`\nGenerating agent definition using ${adapter}/${model}...`);

    const files = await generateAndWriteAgentFiles({
      cwd: process.cwd(),
      description,
      adapter,
      model,
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

async function handleTest(name: string): Promise<void> {
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
  console.log('\nAgent definition is valid.');
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
