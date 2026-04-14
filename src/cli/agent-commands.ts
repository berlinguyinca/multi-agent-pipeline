import * as path from 'path';
import type { AgentDefinition } from '../types/agent-definition.js';
import { loadAgentRegistry } from '../agents/registry.js';

export async function handleAgentCommand(args: string[]): Promise<void> {
  const action = args[0];
  switch (action) {
    case 'list': await handleList(); break;
    case 'create': console.log('Agent creation coming soon. Use --adapter and --model flags.'); break;
    case 'test': {
      const name = args[1];
      if (!name) { console.error('Usage: map agent test <name>'); process.exit(1); }
      await handleTest(name);
      break;
    }
    default: console.log(`Unknown agent command: ${action ?? '(none)'}\n\nUsage:\n  map agent list\n  map agent create\n  map agent test <name>`); break;
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
