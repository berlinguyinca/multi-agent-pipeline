# Smart Agent Routing — Plan 2: Tools, Agent CLI & TUI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add built-in tool execution for agents, `map agent` CLI commands for managing agents, and TUI screens for visualizing DAG routing and execution.

**Architecture:** Tools follow a `Tool` interface and are injected into agent prompts. The orchestrator calls tools when agents request them. CLI subcommands (`map agent list/create/test`) operate independently of the pipeline. TUI adds two new screens (RouterPlanScreen, DAGExecutionScreen) wired into App.tsx alongside the existing flow.

**Tech Stack:** TypeScript ESM, Vitest, Ink 7 (React TUI), XState 5, `yaml` package, Node.js 22+

**Design Spec:** `docs/superpowers/specs/2026-04-13-smart-agent-routing-design.md` (Sections 4, 6, 7)

**Depends on Plan 1:** Agent registry (`src/agents/`), router (`src/router/`), orchestrator (`src/orchestrator/`), types (`src/types/agent-definition.ts`, `src/types/dag.ts`)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/tools/types.ts` | `Tool` interface, `ToolResult`, `ToolRegistry` |
| `src/tools/registry.ts` | Discover and register tools from agent config |
| `src/tools/builtin/shell.ts` | Shell command execution with sandboxing |
| `src/tools/builtin/file-read.ts` | Read files from working directory |
| `src/tools/inject.ts` | Append tool catalog to agent prompts |
| `src/cli/agent-commands.ts` | `map agent list`, `map agent create`, `map agent test` |
| `src/cli/agent-create-dialog.ts` | LLM-assisted agent creation interview |
| `src/tui/screens/RouterPlanScreen.tsx` | DAG plan visualization before execution |
| `src/tui/screens/DAGExecutionScreen.tsx` | Parallel execution progress display |
| `tests/tools/types.test.ts` | Tool type tests |
| `tests/tools/builtin/shell.test.ts` | Shell tool tests |
| `tests/tools/builtin/file-read.test.ts` | File-read tool tests |
| `tests/tools/inject.test.ts` | Tool injection tests |
| `tests/tools/registry.test.ts` | Tool registry tests |
| `tests/cli/agent-commands.test.ts` | Agent CLI tests |
| `tests/cli/agent-create-dialog.test.ts` | Agent creation dialog tests |
| `tests/tui/screens/RouterPlanScreen.test.tsx` | Router plan screen tests |
| `tests/tui/screens/DAGExecutionScreen.test.tsx` | DAG execution screen tests |

### Modified Files

| File | Change |
|------|--------|
| `src/orchestrator/orchestrator.ts` | Inject tool catalog into agent prompts |
| `src/cli.ts` | Add `agent` subcommand dispatch |
| `src/cli-args.ts` | Add subcommand extraction |
| `src/tui/App.tsx` | Add v2 mode with router/DAG screens |

---

## Phase 1: Tool System

### Task 1: Tool Types

**Files:**
- Create: `src/tools/types.ts`
- Test: `tests/tools/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tools/types.test.ts
import { describe, it, expect } from 'vitest';
import type { Tool, ToolResult, ToolParameter } from '../../src/tools/types.js';
import { formatToolCatalog } from '../../src/tools/types.js';

describe('Tool types', () => {
  const shellTool: Tool = {
    name: 'shell',
    description: 'Execute shell commands',
    parameters: [
      { name: 'command', type: 'string', description: 'The command to run', required: true },
    ],
    execute: async () => ({ success: true, output: '' }),
  };

  const fileReadTool: Tool = {
    name: 'file-read',
    description: 'Read a file from the working directory',
    parameters: [
      { name: 'path', type: 'string', description: 'File path', required: true },
    ],
    execute: async () => ({ success: true, output: '' }),
  };

  describe('formatToolCatalog', () => {
    it('formats a single tool', () => {
      const catalog = formatToolCatalog([shellTool]);
      expect(catalog).toContain('shell');
      expect(catalog).toContain('Execute shell commands');
      expect(catalog).toContain('command');
      expect(catalog).toContain('string');
    });

    it('formats multiple tools', () => {
      const catalog = formatToolCatalog([shellTool, fileReadTool]);
      expect(catalog).toContain('shell');
      expect(catalog).toContain('file-read');
    });

    it('returns empty string for no tools', () => {
      expect(formatToolCatalog([])).toBe('');
    });

    it('marks required parameters', () => {
      const catalog = formatToolCatalog([shellTool]);
      expect(catalog).toContain('required');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement tool types**

```typescript
// src/tools/types.ts

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute(params: Record<string, unknown>): Promise<ToolResult>;
}

export function formatToolCatalog(tools: Tool[]): string {
  if (tools.length === 0) return '';

  const sections = tools.map((tool) => {
    const params = tool.parameters
      .map((p) => `  - ${p.name} (${p.type}${p.required ? ', required' : ''}): ${p.description}`)
      .join('\n');
    return `### ${tool.name}\n${tool.description}\nParameters:\n${params}`;
  });

  return `## Available Tools\n\nYou can call tools by outputting a JSON block:\n\`\`\`json\n{"tool": "<name>", "params": {<parameters>}}\n\`\`\`\n\n${sections.join('\n\n')}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/types.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/types.ts tests/tools/types.test.ts
git commit -m "feat: add tool interface types and catalog formatter"
```

### Task 2: Shell Tool

**Files:**
- Create: `src/tools/builtin/shell.ts`
- Test: `tests/tools/builtin/shell.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tools/builtin/shell.test.ts
import { describe, it, expect } from 'vitest';
import { createShellTool } from '../../../src/tools/builtin/shell.js';

describe('ShellTool', () => {
  it('has correct name and description', () => {
    const tool = createShellTool({});
    expect(tool.name).toBe('shell');
    expect(tool.description).toContain('Execute');
  });

  it('executes a simple command', async () => {
    const tool = createShellTool({});
    const result = await tool.execute({ command: 'echo hello' });
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('hello');
  });

  it('restricts to allowed commands when configured', async () => {
    const tool = createShellTool({ allowedCommands: ['echo'] });
    const result = await tool.execute({ command: 'echo hello' });
    expect(result.success).toBe(true);

    const blocked = await tool.execute({ command: 'rm -rf /' });
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain('not allowed');
  });

  it('reports command failure', async () => {
    const tool = createShellTool({});
    const result = await tool.execute({ command: 'false' });
    expect(result.success).toBe(false);
  });

  it('uses configured working directory', async () => {
    const tool = createShellTool({ workingDir: '/tmp' });
    const result = await tool.execute({ command: 'pwd' });
    expect(result.success).toBe(true);
    expect(result.output.trim()).toContain('/tmp');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/builtin/shell.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement shell tool**

```typescript
// src/tools/builtin/shell.ts
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool, ToolResult } from '../types.js';

const execAsync = promisify(exec);

interface ShellToolConfig {
  allowedCommands?: string[];
  workingDir?: string;
}

export function createShellTool(config: ShellToolConfig): Tool {
  return {
    name: 'shell',
    description: 'Execute shell commands in the working directory',
    parameters: [
      { name: 'command', type: 'string', description: 'The shell command to run', required: true },
    ],
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const command = params['command'] as string;

      if (config.allowedCommands && config.allowedCommands.length > 0) {
        const baseCommand = command.split(/\s+/)[0];
        if (!config.allowedCommands.includes(baseCommand)) {
          return { success: false, output: '', error: `Command "${baseCommand}" is not allowed. Allowed: ${config.allowedCommands.join(', ')}` };
        }
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: config.workingDir,
          timeout: 30_000,
        });
        return { success: true, output: stdout + stderr };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, output: '', error: message };
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/builtin/shell.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/builtin/shell.ts tests/tools/builtin/shell.test.ts
git commit -m "feat: add shell tool with command allowlist and working directory"
```

### Task 3: File-Read Tool

**Files:**
- Create: `src/tools/builtin/file-read.ts`
- Test: `tests/tools/builtin/file-read.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tools/builtin/file-read.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createFileReadTool } from '../../../src/tools/builtin/file-read.js';

describe('FileReadTool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-read-test-'));
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'hello world');
    await fs.mkdir(path.join(tmpDir, 'sub'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'sub', 'nested.txt'), 'nested content');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('has correct name', () => {
    const tool = createFileReadTool({ workingDir: tmpDir });
    expect(tool.name).toBe('file-read');
  });

  it('reads a file', async () => {
    const tool = createFileReadTool({ workingDir: tmpDir });
    const result = await tool.execute({ path: 'test.txt' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('hello world');
  });

  it('reads nested files', async () => {
    const tool = createFileReadTool({ workingDir: tmpDir });
    const result = await tool.execute({ path: 'sub/nested.txt' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('nested content');
  });

  it('rejects path traversal', async () => {
    const tool = createFileReadTool({ workingDir: tmpDir });
    const result = await tool.execute({ path: '../../../etc/passwd' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('outside');
  });

  it('returns error for missing file', async () => {
    const tool = createFileReadTool({ workingDir: tmpDir });
    const result = await tool.execute({ path: 'nonexistent.txt' });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/builtin/file-read.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement file-read tool**

```typescript
// src/tools/builtin/file-read.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Tool, ToolResult } from '../types.js';

interface FileReadToolConfig {
  workingDir: string;
  allowedPaths?: string[];
}

export function createFileReadTool(config: FileReadToolConfig): Tool {
  return {
    name: 'file-read',
    description: 'Read a file from the working directory',
    parameters: [
      { name: 'path', type: 'string', description: 'File path relative to working directory', required: true },
    ],
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const filePath = params['path'] as string;
      const resolved = path.resolve(config.workingDir, filePath);

      if (!resolved.startsWith(path.resolve(config.workingDir))) {
        return { success: false, output: '', error: `Path "${filePath}" resolves outside working directory` };
      }

      try {
        const content = await fs.readFile(resolved, 'utf-8');
        return { success: true, output: content };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, output: '', error: message };
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/builtin/file-read.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/builtin/file-read.ts tests/tools/builtin/file-read.test.ts
git commit -m "feat: add file-read tool with path traversal protection"
```

### Task 4: Tool Registry

**Files:**
- Create: `src/tools/registry.ts`
- Test: `tests/tools/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tools/registry.test.ts
import { describe, it, expect } from 'vitest';
import { createToolRegistry } from '../../src/tools/registry.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';

describe('createToolRegistry', () => {
  it('creates shell tool from builtin config', () => {
    const agent: AgentDefinition = {
      name: 'test',
      description: 'test',
      adapter: 'claude',
      prompt: 'test',
      pipeline: [{ name: 'run' }],
      handles: 'test',
      output: { type: 'files' },
      tools: [{ type: 'builtin', name: 'shell', config: { allowedCommands: ['ls'] } }],
    };

    const tools = createToolRegistry(agent, '/tmp');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('shell');
  });

  it('creates file-read tool from builtin config', () => {
    const agent: AgentDefinition = {
      name: 'test',
      description: 'test',
      adapter: 'claude',
      prompt: 'test',
      pipeline: [{ name: 'run' }],
      handles: 'test',
      output: { type: 'files' },
      tools: [{ type: 'builtin', name: 'file-read' }],
    };

    const tools = createToolRegistry(agent, '/tmp');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('file-read');
  });

  it('returns empty array for no tools', () => {
    const agent: AgentDefinition = {
      name: 'test',
      description: 'test',
      adapter: 'claude',
      prompt: 'test',
      pipeline: [{ name: 'run' }],
      handles: 'test',
      output: { type: 'answer' },
      tools: [],
    };

    const tools = createToolRegistry(agent, '/tmp');
    expect(tools).toHaveLength(0);
  });

  it('skips unknown builtin tools', () => {
    const agent: AgentDefinition = {
      name: 'test',
      description: 'test',
      adapter: 'claude',
      prompt: 'test',
      pipeline: [{ name: 'run' }],
      handles: 'test',
      output: { type: 'files' },
      tools: [{ type: 'builtin', name: 'unknown-tool' }],
    };

    const tools = createToolRegistry(agent, '/tmp');
    expect(tools).toHaveLength(0);
  });

  it('skips MCP tools with a warning (not yet implemented)', () => {
    const agent: AgentDefinition = {
      name: 'test',
      description: 'test',
      adapter: 'claude',
      prompt: 'test',
      pipeline: [{ name: 'run' }],
      handles: 'test',
      output: { type: 'files' },
      tools: [{ type: 'mcp', uri: 'mcp://localhost:5432' }],
    };

    const tools = createToolRegistry(agent, '/tmp');
    expect(tools).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement tool registry**

```typescript
// src/tools/registry.ts
import type { Tool } from './types.js';
import type { AgentDefinition, BuiltinToolConfig } from '../types/agent-definition.js';
import { createShellTool } from './builtin/shell.js';
import { createFileReadTool } from './builtin/file-read.js';

export function createToolRegistry(agent: AgentDefinition, workingDir: string): Tool[] {
  const tools: Tool[] = [];

  for (const toolConfig of agent.tools) {
    if (toolConfig.type === 'mcp') {
      // MCP tools not yet implemented — skip silently
      continue;
    }

    const tool = createBuiltinTool(toolConfig, workingDir);
    if (tool) {
      tools.push(tool);
    }
  }

  return tools;
}

function createBuiltinTool(config: BuiltinToolConfig, workingDir: string): Tool | null {
  switch (config.name) {
    case 'shell':
      return createShellTool({
        allowedCommands: config.config?.['allowedCommands'] as string[] | undefined,
        workingDir,
      });
    case 'file-read':
      return createFileReadTool({
        workingDir,
        allowedPaths: config.config?.['allowedPaths'] as string[] | undefined,
      });
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/registry.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/registry.ts tests/tools/registry.test.ts
git commit -m "feat: add tool registry — creates tool instances from agent config"
```

### Task 5: Tool Injection into Prompts

**Files:**
- Create: `src/tools/inject.ts`
- Test: `tests/tools/inject.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tools/inject.test.ts
import { describe, it, expect } from 'vitest';
import { injectToolCatalog } from '../../src/tools/inject.js';
import type { Tool } from '../../src/tools/types.js';

describe('injectToolCatalog', () => {
  const mockTool: Tool = {
    name: 'shell',
    description: 'Execute commands',
    parameters: [
      { name: 'command', type: 'string', description: 'The command', required: true },
    ],
    execute: async () => ({ success: true, output: '' }),
  };

  it('appends tool catalog to prompt', () => {
    const result = injectToolCatalog('Your task: do something', [mockTool]);
    expect(result).toContain('Your task: do something');
    expect(result).toContain('Available Tools');
    expect(result).toContain('shell');
  });

  it('returns original prompt when no tools', () => {
    const result = injectToolCatalog('Your task: do something', []);
    expect(result).toBe('Your task: do something');
  });

  it('includes agent system prompt before task', () => {
    const result = injectToolCatalog('task', [mockTool], 'You are a database expert.');
    expect(result).toContain('You are a database expert.');
    expect(result.indexOf('database expert')).toBeLessThan(result.indexOf('task'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/inject.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement tool injection**

```typescript
// src/tools/inject.ts
import type { Tool } from './types.js';
import { formatToolCatalog } from './types.js';

export function injectToolCatalog(
  taskPrompt: string,
  tools: Tool[],
  systemPrompt?: string,
): string {
  const parts: string[] = [];

  if (systemPrompt) {
    parts.push(systemPrompt);
  }

  if (tools.length > 0) {
    parts.push(formatToolCatalog(tools));
  }

  parts.push(taskPrompt);

  return parts.join('\n\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/inject.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/inject.ts tests/tools/inject.test.ts
git commit -m "feat: add tool catalog injection into agent prompts"
```

### Task 6: Wire Tools into Orchestrator

**Files:**
- Modify: `src/orchestrator/orchestrator.ts`
- Modify: `tests/orchestrator/orchestrator.test.ts`

- [ ] **Step 1: Add test for tool injection in orchestrator**

Add to `tests/orchestrator/orchestrator.test.ts`:

```typescript
  it('injects agent system prompt and tool catalog into step context', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'coder', task: 'Build X', dependsOn: [] }],
    };
    const coderAgent = makeAgent('coder', 'files');
    coderAgent.prompt = 'You are a coding expert.';
    coderAgent.tools = [{ type: 'builtin', name: 'shell' }];
    const agents = new Map([['coder', coderAgent]]);

    let capturedPrompt = '';
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        capturedPrompt = prompt;
        yield 'Output';
      },
    }));

    await executeDAG(plan, agents, createAdapter);

    expect(capturedPrompt).toContain('You are a coding expert');
    expect(capturedPrompt).toContain('shell');
    expect(capturedPrompt).toContain('Build X');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/orchestrator.test.ts`
Expected: FAIL — captured prompt doesn't contain system prompt or tools yet

- [ ] **Step 3: Update orchestrator to inject tools**

In `src/orchestrator/orchestrator.ts`, add imports:

```typescript
import { createToolRegistry } from '../tools/registry.js';
import { injectToolCatalog } from '../tools/inject.js';
```

Update the `buildStepContext` function call site inside `executeDAG` to also pass the agent's system prompt and tools. Replace the line:

```typescript
const context = buildStepContext(step.task, step.dependsOn, results);
```

with:

```typescript
const tools = createToolRegistry(agent, process.cwd());
const rawContext = buildStepContext(step.task, step.dependsOn, results);
const context = injectToolCatalog(rawContext, tools, agent.prompt);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/orchestrator.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/orchestrator.ts tests/orchestrator/orchestrator.test.ts
git commit -m "feat: inject agent system prompt and tool catalog into orchestrator steps"
```

---

## Phase 2: Agent CLI

### Task 7: CLI Subcommand Parsing

**Files:**
- Modify: `src/cli-args.ts`
- Modify: `src/cli.ts`
- Test: `tests/cli-args.test.ts` (modify existing)

- [ ] **Step 1: Add subcommand extraction to cli-args.ts**

Read the current `src/cli-args.ts` and add:

```typescript
export function extractSubcommand(args: string[]): { command: string; subArgs: string[] } | null {
  if (args.length === 0) return null;
  const first = args[0];
  if (first.startsWith('-')) return null;

  const knownCommands = ['agent'];
  if (!knownCommands.includes(first)) return null;

  return { command: first, subArgs: args.slice(1) };
}
```

- [ ] **Step 2: Add agent subcommand dispatch to cli.ts**

In `src/cli.ts`, add this BEFORE the `--headless` check (so subcommands take priority):

```typescript
  const subcommand = extractSubcommand(args);
  if (subcommand?.command === 'agent') {
    const { handleAgentCommand } = await import('./cli/agent-commands.js');
    await handleAgentCommand(subcommand.subArgs);
    process.exit(0);
  }
```

Also add to help text:

```
Commands:
  map agent list              List all registered agents
  map agent create            Create a new agent (LLM-assisted)
  map agent test <name>       Test an agent with a sample prompt
```

- [ ] **Step 3: Run existing tests**

Run: `npx vitest run tests/cli-args.test.ts`
Expected: PASS (existing tests unchanged)

- [ ] **Step 4: Commit**

```bash
git add src/cli-args.ts src/cli.ts tests/cli-args.test.ts
git commit -m "feat: add subcommand parsing for agent CLI commands"
```

### Task 8: Agent List Command

**Files:**
- Create: `src/cli/agent-commands.ts`
- Test: `tests/cli/agent-commands.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/cli/agent-commands.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAgentCommand, formatAgentList } from '../../src/cli/agent-commands.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';

describe('formatAgentList', () => {
  const agents = new Map<string, AgentDefinition>([
    ['researcher', {
      name: 'researcher',
      description: 'Synthesizes answers',
      adapter: 'ollama',
      model: 'gemma4',
      prompt: 'You research.',
      pipeline: [{ name: 'research' }],
      handles: 'research questions',
      output: { type: 'answer' },
      tools: [],
    }],
    ['coder', {
      name: 'coder',
      description: 'Code implementation',
      adapter: 'claude',
      prompt: 'You code.',
      pipeline: [{ name: 'spec' }, { name: 'execute' }],
      handles: 'code implementation',
      output: { type: 'files' },
      tools: [{ type: 'builtin', name: 'shell' }],
    }],
  ]);

  it('formats agents as a table', () => {
    const output = formatAgentList(agents);
    expect(output).toContain('researcher');
    expect(output).toContain('coder');
    expect(output).toContain('ollama');
    expect(output).toContain('claude');
    expect(output).toContain('answer');
    expect(output).toContain('files');
  });

  it('shows tool count', () => {
    const output = formatAgentList(agents);
    expect(output).toContain('0');
    expect(output).toContain('1');
  });

  it('shows pipeline stages', () => {
    const output = formatAgentList(agents);
    expect(output).toContain('research');
    expect(output).toContain('spec');
  });

  it('returns message for empty registry', () => {
    const output = formatAgentList(new Map());
    expect(output).toContain('No agents');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/agent-commands.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement agent commands**

```typescript
// src/cli/agent-commands.ts
import * as path from 'path';
import type { AgentDefinition } from '../types/agent-definition.js';
import { loadAgentRegistry } from '../agents/registry.js';

export async function handleAgentCommand(args: string[]): Promise<void> {
  const action = args[0];

  switch (action) {
    case 'list':
      await handleList();
      break;
    case 'create':
      console.log('Agent creation not yet implemented. Coming soon.');
      break;
    case 'test': {
      const name = args[1];
      if (!name) {
        console.error('Usage: map agent test <name>');
        process.exit(1);
      }
      await handleTest(name);
      break;
    }
    default:
      console.log(`Unknown agent command: ${action ?? '(none)'}\n\nUsage:\n  map agent list\n  map agent create\n  map agent test <name>`);
      break;
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

  if (!agent) {
    console.error(`Agent "${name}" not found. Available: ${[...agents.keys()].join(', ') || '(none)'}`);
    process.exit(1);
  }

  console.log(`Testing agent "${name}" (${agent.adapter}${agent.model ? '/' + agent.model : ''})...`);
  console.log(`Description: ${agent.description}`);
  console.log(`Handles: ${agent.handles}`);
  console.log(`Pipeline: ${agent.pipeline.map((s) => s.name).join(' → ')}`);
  console.log(`Output: ${agent.output.type}`);
  console.log(`Tools: ${agent.tools.length}`);
  console.log('\nAgent definition is valid.');
}

export function formatAgentList(agents: Map<string, AgentDefinition>): string {
  if (agents.size === 0) {
    return 'No agents found. Create one with: map agent create';
  }

  const header = 'Name            Adapter    Model      Output  Pipeline                      Tools';
  const divider = '─'.repeat(header.length);

  const rows = [...agents.entries()].map(([name, agent]) => {
    const pipeline = agent.pipeline.map((s) => s.name).join(' → ');
    return [
      name.padEnd(16),
      agent.adapter.padEnd(11),
      (agent.model ?? '-').padEnd(11),
      agent.output.type.padEnd(8),
      pipeline.slice(0, 30).padEnd(30),
      String(agent.tools.length),
    ].join('');
  });

  return `\n${header}\n${divider}\n${rows.join('\n')}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/agent-commands.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/cli/agent-commands.ts tests/cli/agent-commands.test.ts
git commit -m "feat: add map agent list command with formatted table output"
```

### Task 9: Agent Create Dialog

**Files:**
- Create: `src/cli/agent-create-dialog.ts`
- Test: `tests/cli/agent-create-dialog.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/cli/agent-create-dialog.test.ts
import { describe, it, expect, vi } from 'vitest';
import { generateAgentFiles, buildCreationPrompt } from '../../src/cli/agent-create-dialog.js';

describe('buildCreationPrompt', () => {
  it('includes the agent description in the prompt', () => {
    const prompt = buildCreationPrompt('Analyze financial reports and extract key metrics');
    expect(prompt).toContain('financial reports');
    expect(prompt).toContain('agent.yaml');
    expect(prompt).toContain('prompt.md');
  });

  it('requests YAML and markdown output', () => {
    const prompt = buildCreationPrompt('database queries');
    expect(prompt).toContain('YAML');
    expect(prompt).toContain('markdown');
  });
});

describe('generateAgentFiles', () => {
  it('parses LLM output into agent.yaml and prompt.md', () => {
    const llmOutput = `---AGENT_YAML---
name: financial
description: "Analyzes financial reports"
adapter: ollama
model: gemma4
prompt: prompt.md
pipeline:
  - name: analyze
  - name: report
handles: "financial analysis, reports"
output:
  type: data
tools: []
---PROMPT_MD---
# Financial Agent

You are a financial analyst.

## Process
1. Read the financial data
2. Extract key metrics
3. Generate a summary report`;

    const files = generateAgentFiles(llmOutput);

    expect(files.agentYaml).toContain('name: financial');
    expect(files.agentYaml).toContain('adapter: ollama');
    expect(files.promptMd).toContain('Financial Agent');
    expect(files.promptMd).toContain('financial analyst');
    expect(files.name).toBe('financial');
  });

  it('throws on malformed output', () => {
    expect(() => generateAgentFiles('random garbage')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/agent-create-dialog.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement agent creation dialog**

```typescript
// src/cli/agent-create-dialog.ts
import { parse as parseYaml } from 'yaml';

export function buildCreationPrompt(description: string): string {
  return `You are helping create a new agent definition for a multi-agent pipeline system.

The user wants an agent that does: ${description}

Generate two files:

1. An agent.yaml configuration file with these fields:
   - name: short lowercase identifier
   - description: one-line description
   - adapter: one of "claude", "codex", "ollama", "hermes"
   - model: (optional) specific model name
   - prompt: prompt.md
   - pipeline: list of stage names (each stage is a step the agent goes through)
   - handles: comma-separated list of what this agent is good at
   - output: type is one of "answer", "data", "files"
   - tools: array of tool configs (use [] if none needed)

2. A prompt.md file with a rich system prompt in markdown format.

Output the two files separated by markers:

---AGENT_YAML---
<contents of agent.yaml>
---PROMPT_MD---
<contents of prompt.md>

Only output the two files with their markers. No other text.`;
}

export interface GeneratedAgentFiles {
  name: string;
  agentYaml: string;
  promptMd: string;
}

export function generateAgentFiles(llmOutput: string): GeneratedAgentFiles {
  const yamlMatch = llmOutput.match(/---AGENT_YAML---\s*\n([\s\S]*?)---PROMPT_MD---/);
  const promptMatch = llmOutput.match(/---PROMPT_MD---\s*\n([\s\S]*?)$/);

  if (!yamlMatch || !promptMatch) {
    throw new Error('LLM output does not contain expected ---AGENT_YAML--- and ---PROMPT_MD--- markers');
  }

  const agentYaml = yamlMatch[1].trim();
  const promptMd = promptMatch[1].trim();

  const parsed = parseYaml(agentYaml) as { name?: string };
  if (!parsed.name) {
    throw new Error('Generated agent.yaml is missing "name" field');
  }

  return { name: parsed.name, agentYaml, promptMd };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/agent-create-dialog.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/cli/agent-create-dialog.ts tests/cli/agent-create-dialog.test.ts
git commit -m "feat: add agent creation dialog — LLM prompt builder and output parser"
```

### Task 10: Wire Agent Create into CLI

**Files:**
- Modify: `src/cli/agent-commands.ts`

- [ ] **Step 1: Update the create handler**

Replace the placeholder `case 'create'` in `src/cli/agent-commands.ts`:

```typescript
    case 'create': {
      const adapterFlag = extractFlagValue(args, '--adapter') ?? undefined;
      const modelFlag = extractFlagValue(args, '--model') ?? undefined;
      await handleCreate(adapterFlag, modelFlag);
      break;
    }
```

Add the `handleCreate` function and import:

```typescript
import * as fs from 'fs/promises';
import * as readline from 'readline/promises';
import { createAdapter } from '../adapters/adapter-factory.js';
import { loadConfig } from '../config/loader.js';
import { buildCreationPrompt, generateAgentFiles } from './agent-create-dialog.js';

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

    const creationAdapter = createAdapter({ type: adapter as any, model });
    const prompt = buildCreationPrompt(description);

    let output = '';
    for await (const chunk of creationAdapter.run(prompt)) {
      output += chunk;
    }

    const files = generateAgentFiles(output);
    const agentDir = path.join(process.cwd(), 'agents', files.name);

    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(path.join(agentDir, 'agent.yaml'), files.agentYaml + '\n');
    await fs.writeFile(path.join(agentDir, 'prompt.md'), files.promptMd + '\n');

    console.log(`\n✓ Agent "${files.name}" created at agents/${files.name}/`);
    console.log(`  agent.yaml — configuration`);
    console.log(`  prompt.md  — system prompt`);
    console.log(`\nReview the files, then commit to make it available.`);
  } finally {
    rl.close();
  }
}
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/agent-commands.ts
git commit -m "feat: wire agent create command — LLM-assisted interactive dialog"
```

---

## Phase 3: TUI Integration

### Task 11: Router Plan Screen Component

**Files:**
- Create: `src/tui/screens/RouterPlanScreen.tsx`
- Test: `tests/tui/screens/RouterPlanScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/tui/screens/RouterPlanScreen.test.tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import RouterPlanScreen from '../../src/tui/screens/RouterPlanScreen.js';
import type { DAGPlan } from '../../src/types/dag.js';

describe('RouterPlanScreen', () => {
  const plan: DAGPlan = {
    plan: [
      { id: 'step-1', agent: 'researcher', task: 'Research partitioning', dependsOn: [] },
      { id: 'step-2', agent: 'coder', task: 'Implement migration', dependsOn: ['step-1'] },
    ],
  };

  it('renders the plan title', () => {
    const { lastFrame } = render(
      React.createElement(RouterPlanScreen, {
        plan,
        onApprove: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    expect(lastFrame()).toContain('Router Plan');
  });

  it('shows all agent names', () => {
    const { lastFrame } = render(
      React.createElement(RouterPlanScreen, {
        plan,
        onApprove: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    expect(lastFrame()).toContain('researcher');
    expect(lastFrame()).toContain('coder');
  });

  it('shows step tasks', () => {
    const { lastFrame } = render(
      React.createElement(RouterPlanScreen, {
        plan,
        onApprove: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    expect(lastFrame()).toContain('Research partitioning');
    expect(lastFrame()).toContain('Implement migration');
  });

  it('shows dependencies', () => {
    const { lastFrame } = render(
      React.createElement(RouterPlanScreen, {
        plan,
        onApprove: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    expect(lastFrame()).toContain('step-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/screens/RouterPlanScreen.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement RouterPlanScreen**

```tsx
// src/tui/screens/RouterPlanScreen.tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { DAGPlan } from '../../types/dag.js';

interface RouterPlanScreenProps {
  plan: DAGPlan;
  onApprove: () => void;
  onCancel: () => void;
}

export default function RouterPlanScreen({ plan, onApprove, onCancel }: RouterPlanScreenProps) {
  return (
    React.createElement(Box, { flexDirection: 'column', padding: 1 },
      React.createElement(Text, { bold: true, color: 'cyan' }, '  Router Plan'),
      React.createElement(Text, { dimColor: true }, '  ─'.repeat(20)),
      React.createElement(Box, { flexDirection: 'column', marginTop: 1 },
        ...plan.plan.map((step) =>
          React.createElement(Box, { key: step.id, flexDirection: 'column', marginLeft: 2, marginBottom: 1 },
            React.createElement(Text, { bold: true },
              `${step.id} `, React.createElement(Text, { color: 'green' }, `[${step.agent}]`),
            ),
            React.createElement(Text, { dimColor: true }, `  ${step.task}`),
            step.dependsOn.length > 0
              ? React.createElement(Text, { dimColor: true, color: 'yellow' },
                  `  depends on: ${step.dependsOn.join(', ')}`,
                )
              : null,
          ),
        ),
      ),
      React.createElement(Box, { marginTop: 1, marginLeft: 2 },
        React.createElement(Text, { dimColor: true }, 'Enter: Execute  •  Esc: Cancel'),
      ),
    )
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/screens/RouterPlanScreen.test.tsx`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tui/screens/RouterPlanScreen.tsx tests/tui/screens/RouterPlanScreen.test.tsx
git commit -m "feat: add RouterPlanScreen — DAG plan visualization for TUI"
```

### Task 12: DAG Execution Screen Component

**Files:**
- Create: `src/tui/screens/DAGExecutionScreen.tsx`
- Test: `tests/tui/screens/DAGExecutionScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/tui/screens/DAGExecutionScreen.test.tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import DAGExecutionScreen from '../../src/tui/screens/DAGExecutionScreen.js';
import type { StepResult } from '../../src/types/dag.js';

describe('DAGExecutionScreen', () => {
  it('shows running steps', () => {
    const steps: StepResult[] = [
      { id: 'step-1', agent: 'researcher', task: 'Research', status: 'running', duration: 5000 },
      { id: 'step-2', agent: 'coder', task: 'Build', status: 'pending' },
    ];

    const { lastFrame } = render(
      React.createElement(DAGExecutionScreen, { steps }),
    );
    expect(lastFrame()).toContain('researcher');
    expect(lastFrame()).toContain('running');
  });

  it('shows completed steps', () => {
    const steps: StepResult[] = [
      { id: 'step-1', agent: 'researcher', task: 'Research', status: 'completed', outputType: 'answer', duration: 8000 },
    ];

    const { lastFrame } = render(
      React.createElement(DAGExecutionScreen, { steps }),
    );
    expect(lastFrame()).toContain('completed');
  });

  it('shows failed steps with error', () => {
    const steps: StepResult[] = [
      { id: 'step-1', agent: 'database', task: 'Query', status: 'failed', error: 'connection refused', duration: 2000 },
    ];

    const { lastFrame } = render(
      React.createElement(DAGExecutionScreen, { steps }),
    );
    expect(lastFrame()).toContain('failed');
  });

  it('shows waiting steps', () => {
    const steps: StepResult[] = [
      { id: 'step-1', agent: 'researcher', task: 'Research', status: 'running', duration: 1000 },
      { id: 'step-2', agent: 'coder', task: 'Build', status: 'pending' },
    ];

    const { lastFrame } = render(
      React.createElement(DAGExecutionScreen, { steps }),
    );
    expect(lastFrame()).toContain('pending');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/screens/DAGExecutionScreen.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement DAGExecutionScreen**

```tsx
// src/tui/screens/DAGExecutionScreen.tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { StepResult } from '../../types/dag.js';

interface DAGExecutionScreenProps {
  steps: StepResult[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'gray',
  running: 'yellow',
  completed: 'green',
  failed: 'red',
  skipped: 'gray',
};

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  running: '◉',
  completed: '●',
  failed: '✗',
  skipped: '◌',
};

function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function DAGExecutionScreen({ steps }: DAGExecutionScreenProps) {
  return (
    React.createElement(Box, { flexDirection: 'column', padding: 1 },
      React.createElement(Text, { bold: true, color: 'cyan' }, '  Executing Plan'),
      React.createElement(Text, { dimColor: true }, '  ─'.repeat(20)),
      React.createElement(Box, { flexDirection: 'column', marginTop: 1 },
        ...steps.map((step) =>
          React.createElement(Box, { key: step.id, marginLeft: 2, marginBottom: 0 },
            React.createElement(Text, { color: STATUS_COLORS[step.status] ?? 'white' },
              `${STATUS_ICONS[step.status] ?? '?'} `,
            ),
            React.createElement(Text, { bold: true }, `${step.id} `),
            React.createElement(Text, { color: 'green' }, `[${step.agent}] `),
            React.createElement(Text, { dimColor: true }, step.status),
            step.duration
              ? React.createElement(Text, { dimColor: true }, ` ${formatDuration(step.duration)}`)
              : null,
            step.error
              ? React.createElement(Text, { color: 'red' }, ` — ${step.error}`)
              : null,
          ),
        ),
      ),
    )
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/screens/DAGExecutionScreen.test.tsx`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tui/screens/DAGExecutionScreen.tsx tests/tui/screens/DAGExecutionScreen.test.tsx
git commit -m "feat: add DAGExecutionScreen — parallel step progress with status icons"
```

---

## Summary

| Phase | What it builds | Key files |
|-------|---------------|-----------|
| 1 | Tool system | `src/tools/types.ts`, `builtin/shell.ts`, `builtin/file-read.ts`, `registry.ts`, `inject.ts` |
| 2 | Agent CLI | `src/cli/agent-commands.ts`, `src/cli/agent-create-dialog.ts` |
| 3 | TUI screens | `src/tui/screens/RouterPlanScreen.tsx`, `DAGExecutionScreen.tsx` |

**Not included (deferred):**
- MCP client (requires external server setup — tracked as future work)
- `http-api` and `db-connection` built-in tools (shell + file-read cover MVP)
- Full TUI wiring into App.tsx xstate flow (screens are built, wiring requires careful xstate integration — separate task)
