# Smart Agent Routing — Plan 1: Foundation & Core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver end-to-end DAG-based agent routing in headless mode — agents defined in `agents/` directory, LLM router classifies tasks and produces DAG plans, orchestrator runs agents in parallel, headless v2 output, and gh-issue-pipeline consumes it.

**Architecture:** Named agents live in `agents/<name>/` with `agent.yaml` + prompt markdown files. A router LLM reads the agent registry and produces a DAG plan (JSON). A DAG orchestrator executes the plan — running independent agents in parallel, passing outputs between dependent steps. The headless output format bumps to v2 with per-step results and a `dag` graph. `gh-issue-pipeline` parses v2 and branches post-processing by output type (files→PR, answer→comment).

**Tech Stack:** TypeScript ESM, Vitest, Node.js 22+, `yaml` package, XState 5, existing adapter pattern (BaseAdapter → streamProcess)

**Design Spec:** `docs/superpowers/specs/2026-04-13-smart-agent-routing-design.md`

---

## File Structure

### New Files (multi-agent-pipeline)

| File | Responsibility |
|------|---------------|
| `src/types/agent-definition.ts` | Agent definition types: `AgentDefinition`, `AgentToolConfig`, `AgentStageConfig`, `OutputType` |
| `src/types/dag.ts` | DAG types: `DAGPlan`, `DAGStep`, `DAGNode`, `DAGEdge`, `StepResult`, `StepStatus` |
| `src/agents/loader.ts` | Load `agent.yaml` + prompt files from a single agent directory |
| `src/agents/registry.ts` | Discover all agents from `agents/`, merge with `pipeline.yaml` overrides |
| `src/router/router.ts` | LLM router: build prompt from registry, invoke adapter, parse DAG plan |
| `src/router/prompt-builder.ts` | Build the router's classification prompt from agent registry |
| `src/orchestrator/orchestrator.ts` | Execute DAG: parallel steps, data passing, error handling, timeouts |
| `src/adapters/hermes-adapter.ts` | Hermes Agent adapter: `hermes chat -q -Q` |
| `src/headless/result-builder.ts` | Build v2 `HeadlessResult` from orchestrator output |
| `agents/coder/agent.yaml` | Built-in coder agent config |
| `agents/coder/prompt.md` | Built-in coder system prompt |
| `agents/researcher/agent.yaml` | Built-in researcher agent config |
| `agents/researcher/prompt.md` | Built-in researcher system prompt |
| `tests/types/agent-definition.test.ts` | Tests for agent definition types |
| `tests/types/dag.test.ts` | Tests for DAG types |
| `tests/agents/loader.test.ts` | Tests for agent loader |
| `tests/agents/registry.test.ts` | Tests for agent registry |
| `tests/router/router.test.ts` | Tests for LLM router |
| `tests/router/prompt-builder.test.ts` | Tests for router prompt builder |
| `tests/orchestrator/orchestrator.test.ts` | Tests for DAG orchestrator |
| `tests/adapters/hermes-adapter.test.ts` | Tests for Hermes adapter |
| `tests/headless/result-builder.test.ts` | Tests for v2 result builder |

### Modified Files (multi-agent-pipeline)

| File | Change |
|------|--------|
| `src/types/adapter.ts` | Add `'hermes'` to `AdapterType`, add `hermes` to `DetectionResult` |
| `src/adapters/adapter-factory.ts` | Add `hermes` case, register HermesAdapter |
| `src/adapters/detect.ts` | Add Hermes detection |
| `src/types/config.ts` | Add `RouterConfig`, `AgentCreationConfig`, agent overrides to `PipelineConfig` |
| `src/config/schema.ts` | Add validation for `router`, `agentCreation`, v2 agent overrides |
| `src/config/defaults.ts` | Add defaults for router and agentCreation |
| `src/config/loader.ts` | Merge new config sections |
| `src/types/headless.ts` | Add `HeadlessResultV2` type alongside existing v1 |
| `src/headless/runner.ts` | Add v2 codepath using router + orchestrator |
| `src/cli.ts` | Wire `--v2` flag (opt-in during transition) |

### Modified Files (gh-issue-pipeline)

| File | Change |
|------|--------|
| `src/ai/map-wrapper.ts` | Parse v2 contract, extract per-step results |
| `src/pipeline/issue-processor.ts` | Branch post-processing by output type |
| `src/types/index.ts` | Add v2 types |

---

## Phase 1: Agent Definition Types

### Task 1: Agent Definition Types

**Files:**
- Create: `src/types/agent-definition.ts`
- Test: `tests/types/agent-definition.test.ts`

- [ ] **Step 1: Write the failing test for agent definition types**

```typescript
// tests/types/agent-definition.test.ts
import { describe, it, expect } from 'vitest';
import type {
  AgentDefinition,
  AgentToolConfig,
  AgentStageConfig,
  OutputType,
} from '../../src/types/agent-definition.js';
import { isValidAgentDefinition } from '../../src/types/agent-definition.js';

describe('AgentDefinition types', () => {
  it('validates a minimal agent definition', () => {
    const agent: AgentDefinition = {
      name: 'researcher',
      description: 'Synthesizes answers from research',
      adapter: 'claude',
      prompt: 'You are a research specialist.',
      pipeline: [{ name: 'research' }],
      handles: 'research questions, knowledge synthesis',
      output: { type: 'answer' },
      tools: [],
    };
    expect(isValidAgentDefinition(agent)).toBe(true);
  });

  it('validates agent with model and stage prompts', () => {
    const agent: AgentDefinition = {
      name: 'database',
      description: 'Executes database queries',
      adapter: 'ollama',
      model: 'gemma4',
      prompt: 'You are a database expert.',
      pipeline: [
        { name: 'validate-query', prompt: 'Validate the SQL.' },
        { name: 'execute' },
        { name: 'format-results', prompt: 'Format as markdown table.' },
      ],
      handles: 'SQL queries, database schema',
      output: { type: 'data' },
      tools: [
        { type: 'builtin', name: 'db-connection', config: { dialect: 'postgres' } },
        { type: 'mcp', uri: 'mcp://localhost:5432/pg-tools' },
      ],
    };
    expect(isValidAgentDefinition(agent)).toBe(true);
  });

  it('rejects agent without name', () => {
    const agent = {
      description: 'test',
      adapter: 'claude',
      prompt: 'test',
      pipeline: [{ name: 'step1' }],
      handles: 'test',
      output: { type: 'answer' },
      tools: [],
    };
    expect(isValidAgentDefinition(agent as AgentDefinition)).toBe(false);
  });

  it('rejects agent with empty pipeline', () => {
    const agent: AgentDefinition = {
      name: 'bad',
      description: 'test',
      adapter: 'claude',
      prompt: 'test',
      pipeline: [],
      handles: 'test',
      output: { type: 'answer' },
      tools: [],
    };
    expect(isValidAgentDefinition(agent)).toBe(false);
  });

  it('rejects agent with invalid output type', () => {
    const agent = {
      name: 'bad',
      description: 'test',
      adapter: 'claude',
      prompt: 'test',
      pipeline: [{ name: 'step1' }],
      handles: 'test',
      output: { type: 'unknown' },
      tools: [],
    };
    expect(isValidAgentDefinition(agent as AgentDefinition)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/types/agent-definition.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement agent definition types**

```typescript
// src/types/agent-definition.ts
import type { AdapterType } from './adapter.js';

export type OutputType = 'answer' | 'data' | 'files';

export interface AgentOutputConfig {
  type: OutputType;
}

export interface BuiltinToolConfig {
  type: 'builtin';
  name: string;
  config?: Record<string, unknown>;
}

export interface MCPToolConfig {
  type: 'mcp';
  uri: string;
}

export type AgentToolConfig = BuiltinToolConfig | MCPToolConfig;

export interface AgentStageConfig {
  name: string;
  prompt?: string;
}

export interface AgentDefinition {
  name: string;
  description: string;
  adapter: AdapterType;
  model?: string;
  prompt: string;
  pipeline: AgentStageConfig[];
  handles: string;
  output: AgentOutputConfig;
  tools: AgentToolConfig[];
  enabled?: boolean;
}

const VALID_OUTPUT_TYPES: readonly OutputType[] = ['answer', 'data', 'files'];

export function isValidAgentDefinition(agent: AgentDefinition): boolean {
  if (!agent.name || typeof agent.name !== 'string') return false;
  if (!agent.description || typeof agent.description !== 'string') return false;
  if (!agent.prompt || typeof agent.prompt !== 'string') return false;
  if (!agent.handles || typeof agent.handles !== 'string') return false;
  if (!Array.isArray(agent.pipeline) || agent.pipeline.length === 0) return false;
  if (!agent.output || !VALID_OUTPUT_TYPES.includes(agent.output.type)) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/types/agent-definition.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/types/agent-definition.ts tests/types/agent-definition.test.ts
git commit -m "feat: add agent definition types with validation"
```

### Task 2: DAG Types

**Files:**
- Create: `src/types/dag.ts`
- Test: `tests/types/dag.test.ts`

- [ ] **Step 1: Write the failing test for DAG types**

```typescript
// tests/types/dag.test.ts
import { describe, it, expect } from 'vitest';
import type { DAGPlan, DAGStep, StepResult, DAGNode, DAGEdge } from '../../src/types/dag.js';
import { validateDAGPlan, topologicalSort, getReadySteps } from '../../src/types/dag.js';

describe('DAG types', () => {
  const linearPlan: DAGPlan = {
    plan: [
      { id: 'step-1', agent: 'researcher', task: 'Research topic', dependsOn: [] },
      { id: 'step-2', agent: 'coder', task: 'Implement', dependsOn: ['step-1'] },
    ],
  };

  const parallelPlan: DAGPlan = {
    plan: [
      { id: 'step-1', agent: 'researcher', task: 'Research A', dependsOn: [] },
      { id: 'step-2', agent: 'database', task: 'Query B', dependsOn: [] },
      { id: 'step-3', agent: 'coder', task: 'Implement', dependsOn: ['step-1', 'step-2'] },
    ],
  };

  describe('validateDAGPlan', () => {
    it('accepts a valid linear plan', () => {
      expect(validateDAGPlan(linearPlan)).toEqual({ valid: true });
    });

    it('accepts a valid parallel plan', () => {
      expect(validateDAGPlan(parallelPlan)).toEqual({ valid: true });
    });

    it('rejects empty plan', () => {
      const result = validateDAGPlan({ plan: [] });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('rejects duplicate step ids', () => {
      const plan: DAGPlan = {
        plan: [
          { id: 'step-1', agent: 'a', task: 'x', dependsOn: [] },
          { id: 'step-1', agent: 'b', task: 'y', dependsOn: [] },
        ],
      };
      const result = validateDAGPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('duplicate');
    });

    it('rejects reference to unknown dependency', () => {
      const plan: DAGPlan = {
        plan: [
          { id: 'step-1', agent: 'a', task: 'x', dependsOn: ['step-99'] },
        ],
      };
      const result = validateDAGPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('unknown');
    });

    it('rejects cyclic dependency', () => {
      const plan: DAGPlan = {
        plan: [
          { id: 'step-1', agent: 'a', task: 'x', dependsOn: ['step-2'] },
          { id: 'step-2', agent: 'b', task: 'y', dependsOn: ['step-1'] },
        ],
      };
      const result = validateDAGPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cycle');
    });
  });

  describe('topologicalSort', () => {
    it('sorts linear plan in order', () => {
      const sorted = topologicalSort(linearPlan);
      expect(sorted.map((s) => s.id)).toEqual(['step-1', 'step-2']);
    });

    it('puts independent steps before dependents', () => {
      const sorted = topologicalSort(parallelPlan);
      const step3Idx = sorted.findIndex((s) => s.id === 'step-3');
      const step1Idx = sorted.findIndex((s) => s.id === 'step-1');
      const step2Idx = sorted.findIndex((s) => s.id === 'step-2');
      expect(step3Idx).toBeGreaterThan(step1Idx);
      expect(step3Idx).toBeGreaterThan(step2Idx);
    });
  });

  describe('getReadySteps', () => {
    it('returns steps with no dependencies first', () => {
      const completed = new Set<string>();
      const ready = getReadySteps(parallelPlan, completed);
      expect(ready.map((s) => s.id).sort()).toEqual(['step-1', 'step-2']);
    });

    it('returns dependent step once dependencies are met', () => {
      const completed = new Set(['step-1', 'step-2']);
      const ready = getReadySteps(parallelPlan, completed);
      expect(ready.map((s) => s.id)).toEqual(['step-3']);
    });

    it('returns empty when nothing is ready', () => {
      const completed = new Set(['step-1']);
      const ready = getReadySteps(parallelPlan, completed);
      expect(ready).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/types/dag.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement DAG types and utilities**

```typescript
// src/types/dag.ts

export interface DAGStep {
  id: string;
  agent: string;
  task: string;
  dependsOn: string[];
}

export interface DAGPlan {
  plan: DAGStep[];
}

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StepResult {
  id: string;
  agent: string;
  task: string;
  status: StepStatus;
  outputType?: 'answer' | 'data' | 'files';
  output?: string;
  filesCreated?: string[];
  pipeline?: Array<{ stage: string; status: string; duration: number }>;
  duration?: number;
  error?: string;
  reason?: string;
}

export interface DAGNode {
  id: string;
  agent: string;
  status: string;
  duration: number;
}

export interface DAGEdge {
  from: string;
  to: string;
}

export interface DAGResult {
  nodes: DAGNode[];
  edges: DAGEdge[];
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateDAGPlan(plan: DAGPlan): ValidationResult {
  if (plan.plan.length === 0) {
    return { valid: false, error: 'Plan is empty' };
  }

  const ids = new Set<string>();
  for (const step of plan.plan) {
    if (ids.has(step.id)) {
      return { valid: false, error: `Plan has duplicate step id: ${step.id}` };
    }
    ids.add(step.id);
  }

  for (const step of plan.plan) {
    for (const dep of step.dependsOn) {
      if (!ids.has(dep)) {
        return { valid: false, error: `Step ${step.id} depends on unknown step: ${dep}` };
      }
    }
  }

  if (hasCycle(plan)) {
    return { valid: false, error: 'Plan has a cycle in dependencies' };
  }

  return { valid: true };
}

function hasCycle(plan: DAGPlan): boolean {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const adjMap = new Map<string, string[]>();

  for (const step of plan.plan) {
    adjMap.set(step.id, step.dependsOn);
  }

  function dfs(id: string): boolean {
    if (inStack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    for (const dep of adjMap.get(id) ?? []) {
      if (dfs(dep)) return true;
    }
    inStack.delete(id);
    return false;
  }

  for (const step of plan.plan) {
    if (dfs(step.id)) return true;
  }
  return false;
}

export function topologicalSort(plan: DAGPlan): DAGStep[] {
  const inDegree = new Map<string, number>();
  const stepMap = new Map<string, DAGStep>();
  const dependents = new Map<string, string[]>();

  for (const step of plan.plan) {
    stepMap.set(step.id, step);
    inDegree.set(step.id, step.dependsOn.length);
    for (const dep of step.dependsOn) {
      const existing = dependents.get(dep) ?? [];
      existing.push(step.id);
      dependents.set(dep, existing);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: DAGStep[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(stepMap.get(id)!);
    for (const dep of dependents.get(id) ?? []) {
      const newDegree = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, newDegree);
      if (newDegree === 0) queue.push(dep);
    }
  }

  return sorted;
}

export function getReadySteps(plan: DAGPlan, completed: Set<string>): DAGStep[] {
  return plan.plan.filter(
    (step) =>
      !completed.has(step.id) &&
      step.dependsOn.every((dep) => completed.has(dep)),
  );
}

export function buildDAGResult(results: StepResult[], plan: DAGPlan): DAGResult {
  const resultMap = new Map(results.map((r) => [r.id, r]));

  const nodes: DAGNode[] = plan.plan.map((step) => {
    const result = resultMap.get(step.id);
    return {
      id: step.id,
      agent: step.agent,
      status: result?.status ?? 'pending',
      duration: result?.duration ?? 0,
    };
  });

  const edges: DAGEdge[] = [];
  for (const step of plan.plan) {
    for (const dep of step.dependsOn) {
      edges.push({ from: dep, to: step.id });
    }
  }

  return { nodes, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/types/dag.test.ts`
Expected: PASS (all 9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/types/dag.ts tests/types/dag.test.ts
git commit -m "feat: add DAG plan types with validation, topological sort, and ready-step detection"
```

---

## Phase 2: Agent Registry

### Task 3: Agent Loader (Single Agent Directory)

**Files:**
- Create: `src/agents/loader.ts`
- Test: `tests/agents/loader.test.ts`
- Create: test fixtures at `tests/agents/fixtures/`

- [ ] **Step 1: Create test fixtures**

Create `tests/agents/fixtures/valid-agent/agent.yaml`:

```yaml
name: test-agent
description: "A test agent for validation"
adapter: claude
model: sonnet
prompt: prompt.md
pipeline:
  - name: analyze
    prompt: stages/analyze.md
  - name: summarize
handles: "test tasks"
output:
  type: answer
tools:
  - type: builtin
    name: shell
    config:
      allowedCommands: ["ls"]
```

Create `tests/agents/fixtures/valid-agent/prompt.md`:

```markdown
# Test Agent

You are a test agent. Respond concisely.
```

Create `tests/agents/fixtures/valid-agent/stages/analyze.md`:

```markdown
Analyze the input carefully. List key findings.
```

Create `tests/agents/fixtures/minimal-agent/agent.yaml`:

```yaml
name: minimal
description: "Minimal agent"
adapter: ollama
model: gemma4
prompt: prompt.md
pipeline:
  - name: run
handles: "anything"
output:
  type: answer
tools: []
```

Create `tests/agents/fixtures/minimal-agent/prompt.md`:

```markdown
You are a minimal agent.
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/agents/loader.test.ts
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { loadAgentFromDirectory } from '../../src/agents/loader.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

describe('loadAgentFromDirectory', () => {
  it('loads a valid agent with stage prompts', async () => {
    const agent = await loadAgentFromDirectory(path.join(FIXTURES, 'valid-agent'));

    expect(agent.name).toBe('test-agent');
    expect(agent.description).toBe('A test agent for validation');
    expect(agent.adapter).toBe('claude');
    expect(agent.model).toBe('sonnet');
    expect(agent.prompt).toContain('You are a test agent');
    expect(agent.pipeline).toHaveLength(2);
    expect(agent.pipeline[0].name).toBe('analyze');
    expect(agent.pipeline[0].prompt).toContain('Analyze the input carefully');
    expect(agent.pipeline[1].name).toBe('summarize');
    expect(agent.pipeline[1].prompt).toBeUndefined();
    expect(agent.handles).toBe('test tasks');
    expect(agent.output.type).toBe('answer');
    expect(agent.tools).toHaveLength(1);
    expect(agent.tools[0].type).toBe('builtin');
  });

  it('loads a minimal agent', async () => {
    const agent = await loadAgentFromDirectory(path.join(FIXTURES, 'minimal-agent'));

    expect(agent.name).toBe('minimal');
    expect(agent.adapter).toBe('ollama');
    expect(agent.model).toBe('gemma4');
    expect(agent.prompt).toContain('minimal agent');
    expect(agent.pipeline).toHaveLength(1);
    expect(agent.tools).toEqual([]);
  });

  it('throws for missing agent.yaml', async () => {
    await expect(
      loadAgentFromDirectory(path.join(FIXTURES, 'nonexistent')),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/agents/loader.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement agent loader**

```typescript
// src/agents/loader.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import type { AgentDefinition, AgentStageConfig, AgentToolConfig } from '../types/agent-definition.js';
import { isValidAgentDefinition } from '../types/agent-definition.js';

interface RawAgentYaml {
  name: string;
  description: string;
  adapter: string;
  model?: string;
  prompt: string;
  pipeline: Array<string | { name: string; prompt?: string }>;
  handles: string;
  output: { type: string };
  tools: Array<Record<string, unknown>>;
  enabled?: boolean;
}

export async function loadAgentFromDirectory(agentDir: string): Promise<AgentDefinition> {
  const yamlPath = path.join(agentDir, 'agent.yaml');
  const content = await fs.readFile(yamlPath, 'utf-8');
  const raw = parseYaml(content) as RawAgentYaml;

  const mainPrompt = await loadPromptFile(agentDir, raw.prompt);

  const pipeline: AgentStageConfig[] = await Promise.all(
    raw.pipeline.map(async (stage) => {
      if (typeof stage === 'string') {
        return { name: stage };
      }
      const stageConfig: AgentStageConfig = { name: stage.name };
      if (stage.prompt) {
        stageConfig.prompt = await loadPromptFile(agentDir, stage.prompt);
      }
      return stageConfig;
    }),
  );

  const tools: AgentToolConfig[] = (raw.tools ?? []).map((tool) => {
    if (tool['type'] === 'mcp') {
      return { type: 'mcp' as const, uri: tool['uri'] as string };
    }
    return {
      type: 'builtin' as const,
      name: tool['name'] as string,
      ...(tool['config'] ? { config: tool['config'] as Record<string, unknown> } : {}),
    };
  });

  const agent: AgentDefinition = {
    name: raw.name,
    description: raw.description,
    adapter: raw.adapter as AgentDefinition['adapter'],
    model: raw.model,
    prompt: mainPrompt,
    pipeline,
    handles: raw.handles,
    output: { type: raw.output.type as AgentDefinition['output']['type'] },
    tools,
    enabled: raw.enabled,
  };

  if (!isValidAgentDefinition(agent)) {
    throw new Error(`Invalid agent definition in ${yamlPath}`);
  }

  return agent;
}

async function loadPromptFile(baseDir: string, promptPath: string): Promise<string> {
  const fullPath = path.join(baseDir, promptPath);
  return (await fs.readFile(fullPath, 'utf-8')).trim();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/agents/loader.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/agents/loader.ts tests/agents/loader.test.ts tests/agents/fixtures/
git commit -m "feat: add agent loader — reads agent.yaml and prompt files from directory"
```

### Task 4: Agent Registry (Discovery + Override Merge)

**Files:**
- Create: `src/agents/registry.ts`
- Test: `tests/agents/registry.test.ts`

- [ ] **Step 1: Create additional test fixture for override testing**

Create `tests/agents/fixtures/override-agent/agent.yaml`:

```yaml
name: override-test
description: "Agent for testing overrides"
adapter: claude
prompt: prompt.md
pipeline:
  - name: step1
handles: "test"
output:
  type: files
tools:
  - type: builtin
    name: shell
```

Create `tests/agents/fixtures/override-agent/prompt.md`:

```markdown
Override test agent.
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/agents/registry.test.ts
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { loadAgentRegistry, mergeWithOverrides } from '../../src/agents/registry.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

describe('loadAgentRegistry', () => {
  it('discovers all agents in a directory', async () => {
    const agents = await loadAgentRegistry(FIXTURES);

    expect(agents.size).toBeGreaterThanOrEqual(2);
    expect(agents.has('test-agent')).toBe(true);
    expect(agents.has('minimal')).toBe(true);
  });

  it('returns empty map for empty directory', async () => {
    const tmpDir = path.join(FIXTURES, '..', 'empty-agents-dir');
    const fs = await import('fs/promises');
    await fs.mkdir(tmpDir, { recursive: true });

    const agents = await loadAgentRegistry(tmpDir);
    expect(agents.size).toBe(0);

    await fs.rmdir(tmpDir);
  });
});

describe('mergeWithOverrides', () => {
  it('overrides scalar fields', () => {
    const base: AgentDefinition = {
      name: 'test',
      description: 'base',
      adapter: 'claude',
      model: 'sonnet',
      prompt: 'base prompt',
      pipeline: [{ name: 'step1' }],
      handles: 'test',
      output: { type: 'answer' },
      tools: [],
    };

    const overrides = { model: 'opus', adapter: 'hermes' as const };
    const merged = mergeWithOverrides(base, overrides);

    expect(merged.model).toBe('opus');
    expect(merged.adapter).toBe('hermes');
    expect(merged.description).toBe('base');
  });

  it('extends tools by name', () => {
    const base: AgentDefinition = {
      name: 'test',
      description: 'base',
      adapter: 'claude',
      prompt: 'prompt',
      pipeline: [{ name: 'step1' }],
      handles: 'test',
      output: { type: 'files' },
      tools: [{ type: 'builtin', name: 'shell' }],
    };

    const overrides = {
      tools: [
        { type: 'builtin' as const, name: 'shell', config: { allowedCommands: ['ls'] } },
        { type: 'builtin' as const, name: 'http-api', config: { baseUrl: 'https://api.example.com' } },
      ],
    };
    const merged = mergeWithOverrides(base, overrides);

    expect(merged.tools).toHaveLength(2);
    const shell = merged.tools.find((t) => t.type === 'builtin' && t.name === 'shell');
    expect(shell).toBeDefined();
    expect(shell!.type === 'builtin' && shell!.config).toEqual({ allowedCommands: ['ls'] });
  });

  it('sets enabled: false to exclude agent', () => {
    const base: AgentDefinition = {
      name: 'test',
      description: 'base',
      adapter: 'claude',
      prompt: 'prompt',
      pipeline: [{ name: 'step1' }],
      handles: 'test',
      output: { type: 'answer' },
      tools: [],
    };

    const merged = mergeWithOverrides(base, { enabled: false });
    expect(merged.enabled).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/agents/registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement agent registry**

```typescript
// src/agents/registry.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentDefinition, AgentToolConfig } from '../types/agent-definition.js';
import { loadAgentFromDirectory } from './loader.js';

export interface AgentOverrides {
  adapter?: AgentDefinition['adapter'];
  model?: string;
  enabled?: boolean;
  tools?: AgentToolConfig[];
}

export async function loadAgentRegistry(
  agentsDir: string,
): Promise<Map<string, AgentDefinition>> {
  const agents = new Map<string, AgentDefinition>();

  let entries: string[];
  try {
    entries = await fs.readdir(agentsDir);
  } catch {
    return agents;
  }

  for (const entry of entries) {
    const entryPath = path.join(agentsDir, entry);
    const stat = await fs.stat(entryPath);
    if (!stat.isDirectory()) continue;

    const yamlPath = path.join(entryPath, 'agent.yaml');
    try {
      await fs.access(yamlPath);
    } catch {
      continue;
    }

    const agent = await loadAgentFromDirectory(entryPath);
    agents.set(agent.name, agent);
  }

  return agents;
}

export function mergeWithOverrides(
  base: AgentDefinition,
  overrides: AgentOverrides,
): AgentDefinition {
  const merged = { ...base };

  if (overrides.adapter !== undefined) merged.adapter = overrides.adapter;
  if (overrides.model !== undefined) merged.model = overrides.model;
  if (overrides.enabled !== undefined) merged.enabled = overrides.enabled;

  if (overrides.tools !== undefined) {
    const toolMap = new Map<string, AgentToolConfig>();

    for (const tool of base.tools) {
      const key = toolKey(tool);
      toolMap.set(key, tool);
    }

    for (const tool of overrides.tools) {
      const key = toolKey(tool);
      toolMap.set(key, tool);
    }

    merged.tools = [...toolMap.values()];
  }

  return merged;
}

function toolKey(tool: AgentToolConfig): string {
  if (tool.type === 'mcp') return `mcp:${tool.uri}`;
  return `builtin:${tool.name}`;
}

export function getEnabledAgents(
  agents: Map<string, AgentDefinition>,
): Map<string, AgentDefinition> {
  const enabled = new Map<string, AgentDefinition>();
  for (const [name, agent] of agents) {
    if (agent.enabled !== false) {
      enabled.set(name, agent);
    }
  }
  return enabled;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/agents/registry.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/agents/registry.ts tests/agents/registry.test.ts tests/agents/fixtures/override-agent/
git commit -m "feat: add agent registry — discovers agents from directory, merges deployment overrides"
```

---

## Phase 3: Hermes Adapter

### Task 5: Extend AdapterType and DetectionResult

**Files:**
- Modify: `src/types/adapter.ts`
- Modify: `src/adapters/detect.ts`

- [ ] **Step 1: Update AdapterType to include hermes**

In `src/types/adapter.ts`, change line 1:

```typescript
export type AdapterType = 'claude' | 'codex' | 'ollama' | 'hermes';
```

Add `hermes` to `DetectionResult` (after line 25):

```typescript
export interface DetectionResult {
  claude: DetectInfo;
  codex: DetectInfo;
  ollama: OllamaDetectInfo;
  hermes: DetectInfo;
}
```

- [ ] **Step 2: Run existing tests to check for regressions**

Run: `npx vitest run`
Expected: Some tests may fail due to the new `hermes` field in `DetectionResult`. Note which tests fail.

- [ ] **Step 3: Fix any failing tests**

Any test that constructs a `DetectionResult` mock needs the `hermes` field added. Search for `DetectionResult` usage in tests and add `hermes: { installed: false }` to each mock.

- [ ] **Step 4: Run tests again**

Run: `npx vitest run`
Expected: PASS (all existing tests)

- [ ] **Step 5: Commit**

```bash
git add src/types/adapter.ts
git commit -m "feat: add hermes to AdapterType and DetectionResult"
```

### Task 6: Implement Hermes Adapter

**Files:**
- Create: `src/adapters/hermes-adapter.ts`
- Test: `tests/adapters/hermes-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/adapters/hermes-adapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HermesAdapter } from '../../src/adapters/hermes-adapter.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn((_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string }) => void) => {
      cb(null, { stdout: '/usr/local/bin/hermes\n' });
    }),
    spawn: vi.fn(() => {
      const { EventEmitter } = require('events');
      const { Readable } = require('stream');
      const child = new EventEmitter();
      child.stdin = { end: vi.fn() };
      child.stdout = Readable.from(['test output']);
      child.stderr = new Readable({ read() {} });
      child.killed = false;
      child.pid = 1234;
      setTimeout(() => child.emit('close', 0), 10);
      return child;
    }),
  };
});

describe('HermesAdapter', () => {
  let adapter: HermesAdapter;

  beforeEach(() => {
    adapter = new HermesAdapter();
  });

  it('has correct type', () => {
    expect(adapter.type).toBe('hermes');
  });

  it('has undefined model by default', () => {
    expect(adapter.model).toBeUndefined();
  });

  it('accepts model in constructor', () => {
    const withModel = new HermesAdapter('anthropic/claude-sonnet-4');
    expect(withModel.model).toBe('anthropic/claude-sonnet-4');
  });

  it('builds correct args for basic invocation', () => {
    const args = adapter.buildArgs('Hello world');
    expect(args).toContain('chat');
    expect(args).toContain('-q');
    expect(args).toContain('Hello world');
    expect(args).toContain('-Q');
  });

  it('includes --model when model is set', () => {
    const withModel = new HermesAdapter('anthropic/claude-sonnet-4');
    const args = withModel.buildArgs('test');
    expect(args).toContain('--model');
    expect(args).toContain('anthropic/claude-sonnet-4');
  });

  it('includes --yolo flag', () => {
    const args = adapter.buildArgs('test');
    expect(args).toContain('--yolo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/hermes-adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement HermesAdapter**

```typescript
// src/adapters/hermes-adapter.ts
import type { AdapterType, DetectInfo, RunOptions } from '../types/adapter.js';
import { BaseAdapter } from './base-adapter.js';

export class HermesAdapter extends BaseAdapter {
  readonly type: AdapterType = 'hermes';
  readonly model: string | undefined;

  constructor(model?: string) {
    super();
    this.model = model;
  }

  async detect(): Promise<DetectInfo> {
    return this.detectBinary('hermes');
  }

  buildArgs(prompt: string, options?: RunOptions): string[] {
    const args = ['chat', '-q', prompt, '-Q', '--yolo'];

    if (this.model) {
      args.push('--model', this.model);
    }

    if (options?.systemPrompt) {
      args.unshift('-s', options.systemPrompt);
    }

    return args;
  }

  async *run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
    const args = this.buildArgs(prompt, options);

    yield* this.streamProcess('hermes', args, {
      signal: options?.signal,
      cwd: options?.cwd,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/hermes-adapter.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/adapters/hermes-adapter.ts tests/adapters/hermes-adapter.test.ts
git commit -m "feat: add Hermes Agent adapter — hermes chat -q -Q with model/yolo flags"
```

### Task 7: Register Hermes in Factory and Detection

**Files:**
- Modify: `src/adapters/adapter-factory.ts`
- Modify: `src/adapters/detect.ts`

- [ ] **Step 1: Update adapter-factory.ts**

```typescript
// src/adapters/adapter-factory.ts
import type { AdapterConfig, AgentAdapter } from '../types/adapter.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';
import { HermesAdapter } from './hermes-adapter.js';

export function createAdapter(config: AdapterConfig): AgentAdapter {
  switch (config.type) {
    case 'claude':
      return new ClaudeAdapter();
    case 'codex':
      return new CodexAdapter();
    case 'ollama':
      return new OllamaAdapter(config.model, config.host);
    case 'hermes':
      return new HermesAdapter(config.model);
    default: {
      const _exhaustive: never = config.type;
      throw new Error(`Unknown adapter type: ${_exhaustive}`);
    }
  }
}
```

- [ ] **Step 2: Update detect.ts**

```typescript
// src/adapters/detect.ts
import type { DetectionResult } from '../types/adapter.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';
import { HermesAdapter } from './hermes-adapter.js';

export async function detectAllAdapters(ollamaHost?: string): Promise<DetectionResult> {
  const claude = new ClaudeAdapter();
  const codex = new CodexAdapter();
  const ollama = new OllamaAdapter(undefined, ollamaHost);
  const hermes = new HermesAdapter();

  const [claudeInfo, codexInfo, ollamaInfo, hermesInfo] = await Promise.all([
    claude.detect(),
    codex.detect(),
    ollama.detect(),
    hermes.detect(),
  ]);

  return {
    claude: claudeInfo,
    codex: codexInfo,
    ollama: ollamaInfo as DetectionResult['ollama'],
    hermes: hermesInfo,
  };
}
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/adapters/adapter-factory.ts src/adapters/detect.ts
git commit -m "feat: register Hermes adapter in factory and detection"
```

---

## Phase 4: Config Updates

### Task 8: Add Router and AgentCreation Config Types

**Files:**
- Modify: `src/types/config.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/schema.ts`
- Modify: `src/config/loader.ts`

- [ ] **Step 1: Update config types**

Add to `src/types/config.ts`:

```typescript
import type { AdapterType } from './adapter.js';
import type { AgentToolConfig } from './agent-definition.js';

export interface AgentAssignment {
  adapter: AdapterType;
  model?: string;
}

export interface RouterConfig {
  adapter: AdapterType;
  model: string;
  maxSteps: number;
  timeoutMs: number;
}

export interface AgentCreationConfig {
  adapter: AdapterType;
  model: string;
}

// AgentOverrides is already defined in src/agents/registry.ts
// Re-export or reference it here for config usage
export type { AgentOverrides } from '../agents/registry.js';

// ... keep existing interfaces ...

export interface PipelineConfig {
  agents: {
    spec: AgentAssignment;
    review: AgentAssignment;
    qa: AgentAssignment;
    execute: AgentAssignment;
    docs: AgentAssignment;
  };
  agentOverrides: Record<string, AgentOverrides>;
  router: RouterConfig;
  agentCreation: AgentCreationConfig;
  ollama: OllamaConfig;
  quality: QualityConfig;
  outputDir: string;
  gitCheckpoints: boolean;
  headless: HeadlessRuntimeConfig;
}
```

- [ ] **Step 2: Update defaults**

Add to `src/config/defaults.ts`:

```typescript
router: {
  adapter: 'ollama' as AdapterType,
  model: 'gemma4',
  maxSteps: 10,
  timeoutMs: 30_000,
},
agentCreation: {
  adapter: 'ollama' as AdapterType,
  model: 'gemma4',
},
agentOverrides: {},
```

- [ ] **Step 3: Update schema validation**

Add validation for `router`, `agentCreation`, and `agentOverrides` sections in `src/config/schema.ts`. Accept these new fields in `validateConfig()`.

- [ ] **Step 4: Update loader merge logic**

Update `deepMerge()` in `src/config/loader.ts` to merge the new fields.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: PASS — some config tests may need updating for new required fields

- [ ] **Step 6: Fix any failing config tests**

Update test mocks/fixtures that construct `PipelineConfig` to include the new fields with default values.

- [ ] **Step 7: Run tests again**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/types/config.ts src/config/defaults.ts src/config/schema.ts src/config/loader.ts tests/
git commit -m "feat: add router, agentCreation, and agentOverrides to pipeline config"
```

---

## Phase 5: Router

### Task 9: Router Prompt Builder

**Files:**
- Create: `src/router/prompt-builder.ts`
- Test: `tests/router/prompt-builder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/router/prompt-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildRouterPrompt } from '../../src/router/prompt-builder.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';

describe('buildRouterPrompt', () => {
  const agents = new Map<string, AgentDefinition>([
    ['researcher', {
      name: 'researcher',
      description: 'Synthesizes answers from research',
      adapter: 'claude',
      prompt: 'You are a researcher.',
      pipeline: [{ name: 'research' }, { name: 'summarize' }],
      handles: 'research questions, knowledge synthesis',
      output: { type: 'answer' },
      tools: [],
    }],
    ['coder', {
      name: 'coder',
      description: 'Full spec-to-code lifecycle',
      adapter: 'claude',
      prompt: 'You implement software.',
      pipeline: [{ name: 'spec' }, { name: 'execute' }],
      handles: 'code implementation, features, bug fixes',
      output: { type: 'files' },
      tools: [],
    }],
  ]);

  it('includes all agent names in prompt', () => {
    const prompt = buildRouterPrompt(agents, 'Build a REST API');
    expect(prompt).toContain('researcher');
    expect(prompt).toContain('coder');
  });

  it('includes agent handles descriptions', () => {
    const prompt = buildRouterPrompt(agents, 'Build a REST API');
    expect(prompt).toContain('research questions, knowledge synthesis');
    expect(prompt).toContain('code implementation, features, bug fixes');
  });

  it('includes the user task', () => {
    const prompt = buildRouterPrompt(agents, 'Build a REST API');
    expect(prompt).toContain('Build a REST API');
  });

  it('requests JSON output with plan array', () => {
    const prompt = buildRouterPrompt(agents, 'test');
    expect(prompt).toContain('"plan"');
    expect(prompt).toContain('"id"');
    expect(prompt).toContain('"agent"');
    expect(prompt).toContain('"task"');
    expect(prompt).toContain('"dependsOn"');
  });

  it('enforces maxSteps', () => {
    const prompt = buildRouterPrompt(agents, 'test', 5);
    expect(prompt).toContain('5');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router/prompt-builder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement router prompt builder**

```typescript
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

  return `You are a task router. Analyze the user's task and create an execution plan using the available agents.

## Available Agents

${agentDescriptions}

## User Task

${userTask}

## Instructions

1. Decide which agent(s) are needed for this task.
2. If the task requires multiple agents, break it into steps with dependencies.
3. Steps with no dependencies on each other can run in parallel (use empty dependsOn).
4. Use at most ${maxSteps} steps.
5. Each step's "task" field should be a clear, scoped sub-task description for that agent.
6. Only use agent names from the list above.

## Output Format

Respond with ONLY valid JSON, no markdown fences, no explanation:

{"plan":[{"id":"step-1","agent":"<agent-name>","task":"<sub-task description>","dependsOn":[]},{"id":"step-2","agent":"<agent-name>","task":"<sub-task description>","dependsOn":["step-1"]}]}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/router/prompt-builder.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/router/prompt-builder.ts tests/router/prompt-builder.test.ts
git commit -m "feat: add router prompt builder — generates classification prompt from agent registry"
```

### Task 10: Router Implementation

**Files:**
- Create: `src/router/router.ts`
- Test: `tests/router/router.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/router/router.test.ts
import { describe, it, expect, vi } from 'vitest';
import { routeTask } from '../../src/router/router.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';
import type { AgentAdapter } from '../../src/types/adapter.js';
import type { DAGPlan } from '../../src/types/dag.js';
import type { RouterConfig } from '../../src/types/config.js';

function mockAdapter(response: string): AgentAdapter {
  return {
    type: 'ollama',
    model: 'gemma4',
    detect: vi.fn(),
    cancel: vi.fn(),
    async *run() {
      yield response;
    },
  };
}

const agents = new Map<string, AgentDefinition>([
  ['researcher', {
    name: 'researcher',
    description: 'Research agent',
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
    description: 'Coding agent',
    adapter: 'claude',
    prompt: 'You code.',
    pipeline: [{ name: 'execute' }],
    handles: 'code implementation',
    output: { type: 'files' },
    tools: [],
  }],
]);

const routerConfig: RouterConfig = {
  adapter: 'ollama',
  model: 'gemma4',
  maxSteps: 10,
  timeoutMs: 30_000,
};

describe('routeTask', () => {
  it('parses a single-agent plan', async () => {
    const json = '{"plan":[{"id":"step-1","agent":"researcher","task":"Research topic","dependsOn":[]}]}';
    const adapter = mockAdapter(json);

    const plan = await routeTask('What is PostgreSQL?', agents, adapter, routerConfig);

    expect(plan.plan).toHaveLength(1);
    expect(plan.plan[0].agent).toBe('researcher');
  });

  it('parses a multi-agent plan', async () => {
    const json = '{"plan":[{"id":"step-1","agent":"researcher","task":"Research","dependsOn":[]},{"id":"step-2","agent":"coder","task":"Implement","dependsOn":["step-1"]}]}';
    const adapter = mockAdapter(json);

    const plan = await routeTask('Research and build', agents, adapter, routerConfig);

    expect(plan.plan).toHaveLength(2);
    expect(plan.plan[1].dependsOn).toEqual(['step-1']);
  });

  it('throws on invalid JSON', async () => {
    const adapter = mockAdapter('not json');

    await expect(
      routeTask('test', agents, adapter, routerConfig),
    ).rejects.toThrow();
  });

  it('throws on invalid DAG (unknown agent)', async () => {
    const json = '{"plan":[{"id":"step-1","agent":"unknown-agent","task":"test","dependsOn":[]}]}';
    const adapter = mockAdapter(json);

    await expect(
      routeTask('test', agents, adapter, routerConfig),
    ).rejects.toThrow('unknown agent');
  });

  it('strips markdown fences from response', async () => {
    const json = '```json\n{"plan":[{"id":"step-1","agent":"researcher","task":"test","dependsOn":[]}]}\n```';
    const adapter = mockAdapter(json);

    const plan = await routeTask('test', agents, adapter, routerConfig);
    expect(plan.plan).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router/router.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement router**

```typescript
// src/router/router.ts
import type { AgentAdapter } from '../types/adapter.js';
import type { AgentDefinition } from '../types/agent-definition.js';
import type { DAGPlan } from '../types/dag.js';
import type { RouterConfig } from '../types/config.js';
import { validateDAGPlan } from '../types/dag.js';
import { buildRouterPrompt } from './prompt-builder.js';

export async function routeTask(
  userTask: string,
  agents: Map<string, AgentDefinition>,
  routerAdapter: AgentAdapter,
  config: RouterConfig,
): Promise<DAGPlan> {
  const prompt = buildRouterPrompt(agents, userTask, config.maxSteps);

  let output = '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    for await (const chunk of routerAdapter.run(prompt, { signal: controller.signal })) {
      output += chunk;
    }
  } finally {
    clearTimeout(timeout);
  }

  const cleaned = stripMarkdownFences(output.trim());

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Router returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  const plan = parsed as DAGPlan;

  for (const step of plan.plan) {
    if (!agents.has(step.agent)) {
      throw new Error(
        `Router referenced unknown agent: "${step.agent}". Available: ${[...agents.keys()].join(', ')}`,
      );
    }
  }

  const validation = validateDAGPlan(plan);
  if (!validation.valid) {
    throw new Error(`Router produced invalid DAG: ${validation.error}`);
  }

  return plan;
}

function stripMarkdownFences(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  return match ? match[1].trim() : text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/router/router.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/router/router.ts tests/router/router.test.ts
git commit -m "feat: add LLM router — classifies tasks, produces validated DAG plans"
```

---

## Phase 6: DAG Orchestrator

### Task 11: DAG Orchestrator

**Files:**
- Create: `src/orchestrator/orchestrator.ts`
- Test: `tests/orchestrator/orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/orchestrator/orchestrator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { executeDAG } from '../../src/orchestrator/orchestrator.js';
import type { DAGPlan } from '../../src/types/dag.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';
import type { AgentAdapter } from '../../src/types/adapter.js';

function mockAdapter(output: string): AgentAdapter {
  return {
    type: 'claude',
    model: undefined,
    detect: vi.fn(),
    cancel: vi.fn(),
    async *run() {
      yield output;
    },
  };
}

function makeAgent(name: string, outputType: 'answer' | 'data' | 'files' = 'answer'): AgentDefinition {
  return {
    name,
    description: `${name} agent`,
    adapter: 'claude',
    prompt: `You are ${name}.`,
    pipeline: [{ name: 'run' }],
    handles: name,
    output: { type: outputType },
    tools: [],
  };
}

describe('executeDAG', () => {
  it('executes a single-step DAG', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => mockAdapter('Research result'));

    const result = await executeDAG(plan, agents, createAdapter);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[0].output).toBe('Research result');
    expect(result.steps[0].outputType).toBe('answer');
  });

  it('executes parallel steps concurrently', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research A', dependsOn: [] },
        { id: 'step-2', agent: 'researcher', task: 'Research B', dependsOn: [] },
      ],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => mockAdapter('Result'));

    const result = await executeDAG(plan, agents, createAdapter);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps.every((s) => s.status === 'completed')).toBe(true);
  });

  it('passes dependency output as context', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] },
        { id: 'step-2', agent: 'coder', task: 'Build X', dependsOn: ['step-1'] },
      ],
    };
    const agents = new Map([
      ['researcher', makeAgent('researcher')],
      ['coder', makeAgent('coder', 'files')],
    ]);
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

    expect(capturedPrompt).toContain('Research X');
    expect(capturedPrompt).toContain('step-1');
  });

  it('skips steps when dependency fails', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] },
        { id: 'step-2', agent: 'coder', task: 'Build X', dependsOn: ['step-1'] },
      ],
    };
    const agents = new Map([
      ['researcher', makeAgent('researcher')],
      ['coder', makeAgent('coder', 'files')],
    ]);
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        throw new Error('Adapter failed');
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter);

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[1].status).toBe('skipped');
    expect(result.steps[1].reason).toContain('step-1');
  });

  it('reports partial success', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research', dependsOn: [] },
        { id: 'step-2', agent: 'coder', task: 'Build', dependsOn: [] },
      ],
    };
    const agents = new Map([
      ['researcher', makeAgent('researcher')],
      ['coder', makeAgent('coder', 'files')],
    ]);
    let callCount = 0;
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        callCount += 1;
        if (callCount === 1) yield 'Success';
        else throw new Error('Failed');
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter);

    expect(result.success).toBe(false);
    const completed = result.steps.filter((s) => s.status === 'completed');
    const failed = result.steps.filter((s) => s.status === 'failed');
    expect(completed).toHaveLength(1);
    expect(failed).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/orchestrator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement DAG orchestrator**

```typescript
// src/orchestrator/orchestrator.ts
import type { AgentAdapter, AdapterConfig } from '../types/adapter.js';
import type { AgentDefinition } from '../types/agent-definition.js';
import type { DAGPlan, StepResult, StepStatus } from '../types/dag.js';
import { getReadySteps } from '../types/dag.js';

export interface DAGExecutionResult {
  success: boolean;
  steps: StepResult[];
}

type AdapterFactory = (config: AdapterConfig) => AgentAdapter;

export async function executeDAG(
  plan: DAGPlan,
  agents: Map<string, AgentDefinition>,
  createAdapter: AdapterFactory,
): Promise<DAGExecutionResult> {
  const results = new Map<string, StepResult>();
  const completed = new Set<string>();
  const failed = new Set<string>();
  const running = new Set<string>();
  const allIds = new Set(plan.plan.map((s) => s.id));

  while (completed.size + failed.size < allIds.size) {
    // Skip steps whose dependencies failed
    for (const step of plan.plan) {
      if (completed.has(step.id) || failed.has(step.id) || running.has(step.id)) continue;
      const depFailed = step.dependsOn.some((dep) => failed.has(dep));
      if (depFailed) {
        const failedDeps = step.dependsOn.filter((dep) => failed.has(dep));
        results.set(step.id, {
          id: step.id,
          agent: step.agent,
          task: step.task,
          status: 'skipped',
          reason: `Dependency failed: ${failedDeps.join(', ')}`,
        });
        failed.add(step.id);
      }
    }

    const ready = getReadySteps(plan, completed).filter(
      (s) => !running.has(s.id) && !failed.has(s.id),
    );

    if (ready.length === 0 && running.size === 0) break;
    if (ready.length === 0) {
      // Wait for running steps — should not happen with correct DAG
      break;
    }

    const executions = ready.map(async (step) => {
      running.add(step.id);
      const agent = agents.get(step.agent)!;
      const startedAt = Date.now();

      try {
        const context = buildStepContext(step.task, step.dependsOn, results);
        const adapter = createAdapter({
          type: agent.adapter,
          model: agent.model,
        });

        let output = '';
        for await (const chunk of adapter.run(context)) {
          output += chunk;
        }

        const result: StepResult = {
          id: step.id,
          agent: step.agent,
          task: step.task,
          status: 'completed',
          outputType: agent.output.type,
          output: output.trim(),
          duration: Date.now() - startedAt,
        };
        results.set(step.id, result);
        completed.add(step.id);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.set(step.id, {
          id: step.id,
          agent: step.agent,
          task: step.task,
          status: 'failed',
          error: message,
          duration: Date.now() - startedAt,
        });
        failed.add(step.id);
      } finally {
        running.delete(step.id);
      }
    });

    await Promise.all(executions);
  }

  const stepResults = plan.plan.map((step) => results.get(step.id) ?? {
    id: step.id,
    agent: step.agent,
    task: step.task,
    status: 'pending' as StepStatus,
  });

  return {
    success: failed.size === 0,
    steps: stepResults,
  };
}

function buildStepContext(
  task: string,
  dependsOn: string[],
  results: Map<string, StepResult>,
): string {
  let context = `Your task: ${task}`;

  if (dependsOn.length > 0) {
    const depOutputs = dependsOn
      .map((depId) => {
        const result = results.get(depId);
        if (!result || !result.output) return null;
        return `[${depId}: ${result.agent}]\n${result.output}`;
      })
      .filter(Boolean);

    if (depOutputs.length > 0) {
      context += `\n\n--- Context from previous steps ---\n\n${depOutputs.join('\n\n')}`;
    }
  }

  return context;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/orchestrator.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/orchestrator.ts tests/orchestrator/orchestrator.test.ts
git commit -m "feat: add DAG orchestrator — parallel execution, data passing, error handling"
```

---

## Phase 7: Headless V2 Output

### Task 12: V2 Result Types and Builder

**Files:**
- Modify: `src/types/headless.ts`
- Create: `src/headless/result-builder.ts`
- Test: `tests/headless/result-builder.test.ts`

- [ ] **Step 1: Add V2 types to headless.ts**

```typescript
// src/types/headless.ts — add after existing HeadlessResult
import type { DocumentationResult, QaAssessment } from './spec.js';
import type { GitHubReportResult } from './github.js';
import type { DAGResult, StepResult } from './dag.js';

// Keep existing HeadlessResult as-is for backwards compatibility

export interface HeadlessResultV2 {
  version: 2;
  success: boolean;
  dag: DAGResult;
  steps: StepResult[];
  duration: number;
  error?: string | null;
  githubReport?: GitHubReportResult;
}
```

- [ ] **Step 2: Write the failing test for result builder**

```typescript
// tests/headless/result-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildHeadlessResultV2 } from '../../src/headless/result-builder.js';
import type { DAGPlan, StepResult } from '../../src/types/dag.js';

describe('buildHeadlessResultV2', () => {
  it('builds success result from completed DAG', () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research', dependsOn: [] },
        { id: 'step-2', agent: 'coder', task: 'Build', dependsOn: ['step-1'] },
      ],
    };
    const steps: StepResult[] = [
      { id: 'step-1', agent: 'researcher', task: 'Research', status: 'completed', outputType: 'answer', output: 'Found info', duration: 5000 },
      { id: 'step-2', agent: 'coder', task: 'Build', status: 'completed', outputType: 'files', output: 'Built it', filesCreated: ['src/app.ts'], duration: 10000 },
    ];

    const result = buildHeadlessResultV2(plan, steps, 15000);

    expect(result.version).toBe(2);
    expect(result.success).toBe(true);
    expect(result.dag.nodes).toHaveLength(2);
    expect(result.dag.edges).toHaveLength(1);
    expect(result.dag.edges[0]).toEqual({ from: 'step-1', to: 'step-2' });
    expect(result.steps).toEqual(steps);
    expect(result.duration).toBe(15000);
    expect(result.error).toBeNull();
  });

  it('builds failure result with error', () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research', dependsOn: [] }],
    };
    const steps: StepResult[] = [
      { id: 'step-1', agent: 'researcher', task: 'Research', status: 'failed', error: 'timeout', duration: 30000 },
    ];

    const result = buildHeadlessResultV2(plan, steps, 30000);

    expect(result.version).toBe(2);
    expect(result.success).toBe(false);
    expect(result.error).toBeNull();
    expect(result.steps[0].error).toBe('timeout');
  });

  it('includes top-level error when provided', () => {
    const plan: DAGPlan = { plan: [] };
    const result = buildHeadlessResultV2(plan, [], 0, 'Router failed');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Router failed');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/headless/result-builder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement result builder**

```typescript
// src/headless/result-builder.ts
import type { DAGPlan, StepResult } from '../types/dag.js';
import type { HeadlessResultV2 } from '../types/headless.js';
import { buildDAGResult } from '../types/dag.js';

export function buildHeadlessResultV2(
  plan: DAGPlan,
  steps: StepResult[],
  duration: number,
  error?: string,
): HeadlessResultV2 {
  const dag = buildDAGResult(steps, plan);
  const allCompleted = steps.length > 0 && steps.every((s) => s.status === 'completed');
  const success = error === undefined && allCompleted;

  return {
    version: 2,
    success,
    dag,
    steps,
    duration,
    error: error ?? null,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/headless/result-builder.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/types/headless.ts src/headless/result-builder.ts tests/headless/result-builder.test.ts
git commit -m "feat: add headless v2 result types and builder with DAG graph output"
```

### Task 13: Wire V2 into Headless Runner

**Files:**
- Modify: `src/headless/runner.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Add `runHeadlessV2` function to runner.ts**

Add a new exported function in `src/headless/runner.ts` that uses the router + orchestrator:

```typescript
import { loadAgentRegistry, getEnabledAgents, mergeWithOverrides } from '../agents/registry.js';
import { routeTask } from '../router/router.js';
import { executeDAG } from '../orchestrator/orchestrator.js';
import { buildHeadlessResultV2 } from './result-builder.js';
import type { HeadlessResultV2 } from '../types/headless.js';

export async function runHeadlessV2(
  options: HeadlessOptions,
  dependencies: HeadlessDependencies = defaultDependencies,
): Promise<HeadlessResultV2> {
  const startTime = Date.now();

  try {
    const config = await dependencies.loadConfigFn(options.configPath);

    // Load agent registry from agents/ directory
    const agentsDir = path.join(process.cwd(), 'agents');
    const rawAgents = await loadAgentRegistry(agentsDir);

    // Apply deployment overrides from pipeline.yaml
    for (const [name, overrides] of Object.entries(config.agentOverrides)) {
      const base = rawAgents.get(name);
      if (base) {
        rawAgents.set(name, mergeWithOverrides(base, overrides));
      }
    }

    const agents = getEnabledAgents(rawAgents);

    if (agents.size === 0) {
      return buildHeadlessResultV2({ plan: [] }, [], Date.now() - startTime, 'No agents available');
    }

    // Route the task
    const routerAdapter = dependencies.createAdapterFn({
      type: config.router.adapter,
      model: config.router.model,
    });
    const plan = await routeTask(options.prompt, agents, routerAdapter, config.router);

    // Execute the DAG
    const dagResult = await executeDAG(plan, agents, dependencies.createAdapterFn);

    return buildHeadlessResultV2(plan, dagResult.steps, Date.now() - startTime);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return buildHeadlessResultV2({ plan: [] }, [], Date.now() - startTime, message);
  }
}
```

Note: You'll need to add `import * as path from 'path';` at the top of runner.ts if not already present.

- [ ] **Step 2: Add --v2 flag to cli.ts**

In `src/cli.ts`, in the headless block (around line 49), add v2 support:

```typescript
if (args.includes('--headless')) {
  const useV2 = args.includes('--v2');
  // ... existing flag extraction ...

  if (useV2) {
    const { runHeadlessV2 } = await import('./headless/runner.js');
    const result = await runHeadlessV2({
      prompt,
      outputDir,
      configPath,
      personality,
    });
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(result.success ? 0 : 1);
  }

  // ... existing v1 codepath ...
}
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/headless/runner.ts src/cli.ts
git commit -m "feat: wire v2 headless mode — router + orchestrator + DAG output via --v2 flag"
```

---

## Phase 8: Built-in Agent Definitions

### Task 14: Coder Agent Definition

**Files:**
- Create: `agents/coder/agent.yaml`
- Create: `agents/coder/prompt.md`

- [ ] **Step 1: Create coder agent.yaml**

```yaml
# agents/coder/agent.yaml
name: coder
description: "Full spec-to-code lifecycle with TDD and documentation"
adapter: claude
prompt: prompt.md
pipeline:
  - name: spec
  - name: review
  - name: qa
  - name: execute
  - name: code-qa
  - name: docs
handles: "code implementation, new features, bug fixes, refactoring, software projects"
output:
  type: files
tools:
  - type: builtin
    name: shell
```

- [ ] **Step 2: Create coder prompt.md**

```markdown
# Coder Agent

You are a software implementation specialist. You turn specifications into working, tested software.

## Process

1. Write a detailed specification from the requirements
2. Implement using strict TDD: write failing test first, then minimal code to pass
3. Refactor for clarity while keeping tests green
4. Document your work

## Principles

- Every feature starts with a failing test
- Write the minimum code to make tests pass
- Commit frequently with clear messages
- Follow existing code conventions in the project
- Prefer simple, readable code over clever abstractions
```

- [ ] **Step 3: Commit**

```bash
git add agents/coder/
git commit -m "feat: add built-in coder agent definition"
```

### Task 15: Researcher Agent Definition

**Files:**
- Create: `agents/researcher/agent.yaml`
- Create: `agents/researcher/prompt.md`

- [ ] **Step 1: Create researcher agent.yaml**

```yaml
# agents/researcher/agent.yaml
name: researcher
description: "Synthesizes comprehensive answers from knowledge and analysis"
adapter: ollama
model: gemma4
prompt: prompt.md
pipeline:
  - name: research
  - name: summarize
handles: "research questions, knowledge synthesis, explanations, analysis, comparisons, how-to guides"
output:
  type: answer
tools: []
```

- [ ] **Step 2: Create researcher prompt.md**

```markdown
# Researcher Agent

You are a research specialist. Your job is to provide thorough, well-reasoned answers.

## Process

1. Analyze the question to understand what information is needed
2. Synthesize a comprehensive answer from your knowledge
3. Structure the response clearly with sections if needed
4. Cite reasoning and explain trade-offs where applicable

## Output Format

- Be thorough but concise — cover what matters, skip what doesn't
- Use markdown formatting for structure
- When comparing options, use tables
- When explaining processes, use numbered steps
- Always conclude with a clear recommendation or summary
```

- [ ] **Step 3: Commit**

```bash
git add agents/researcher/
git commit -m "feat: add built-in researcher agent definition"
```

---

## Phase 9: gh-issue-pipeline V2 Contract Support

### Task 16: Update MAP Result Types in gh-issue-pipeline

**Files:**
- Modify: `/Users/wohlgemuth/IdeaProjects/gh-issue-pipeline/src/ai/map-wrapper.ts`
- Modify: `/Users/wohlgemuth/IdeaProjects/gh-issue-pipeline/src/types/index.ts` (if types are defined here)

- [ ] **Step 1: Read the current map-wrapper.ts to identify exact line changes**

Run: Read `/Users/wohlgemuth/IdeaProjects/gh-issue-pipeline/src/ai/map-wrapper.ts` fully.

- [ ] **Step 2: Add V2 types**

Add to the types file (or inline in map-wrapper.ts where `MAPResultPayload` is defined):

```typescript
interface MAPStepResult {
  id: string;
  agent: string;
  task: string;
  status: string;
  outputType?: 'answer' | 'data' | 'files';
  output?: string;
  filesCreated?: string[];
  duration?: number;
  error?: string;
}

interface MAPDAGResult {
  nodes: Array<{ id: string; agent: string; status: string; duration: number }>;
  edges: Array<{ from: string; to: string }>;
}

interface MAPResultPayloadV1 {
  version: 1;
  success: boolean;
  spec: string;
  filesCreated: string[];
  error?: string;
}

interface MAPResultPayloadV2 {
  version: 2;
  success: boolean;
  dag: MAPDAGResult;
  steps: MAPStepResult[];
  duration: number;
  error?: string | null;
}

type MAPResultPayload = MAPResultPayloadV1 | MAPResultPayloadV2;
```

- [ ] **Step 3: Update version check to accept 1 or 2**

Where the version is validated (currently `if (result.version !== 1)`), change to:

```typescript
if (result.version !== 1 && result.version !== 2) {
  throw new AIInvocationError(
    `MAP output version mismatch: expected 1 or 2, got ${result.version}`,
    'map',
  );
}
```

- [ ] **Step 4: Add V2 parsing path**

After the version check, branch based on version:

```typescript
if (result.version === 2) {
  const v2 = result as MAPResultPayloadV2;
  if (!v2.success) {
    throw new AIInvocationError(
      v2.error ?? 'MAP pipeline failed',
      'map',
    );
  }
  // Return steps info for issue-processor to handle per output type
  const filesWritten = await scanModifiedFiles(workingDir, beforeMs);
  return {
    success: true,
    filesWritten,
    stdout: JSON.stringify(v2.steps),
    stderr: '',
    mapV2Result: v2,
  };
}
```

- [ ] **Step 5: Commit in gh-issue-pipeline repo**

```bash
cd /Users/wohlgemuth/IdeaProjects/gh-issue-pipeline
git add src/ai/map-wrapper.ts src/types/index.ts
git commit -m "feat: support MAP headless v2 contract — DAG-based routing results"
```

### Task 17: Update Issue Processor for Output Types

**Files:**
- Modify: `/Users/wohlgemuth/IdeaProjects/gh-issue-pipeline/src/pipeline/issue-processor.ts`

- [ ] **Step 1: Read the current issue-processor.ts to understand the post-MAP flow**

Read `/Users/wohlgemuth/IdeaProjects/gh-issue-pipeline/src/pipeline/issue-processor.ts` to identify where MAP results are consumed and where to branch.

- [ ] **Step 2: Add output-type branching after MAP invocation**

After the AI invocation returns, check if the result contains `mapV2Result` and branch:

```typescript
// After MAP returns
if (agentResult.mapV2Result) {
  const v2 = agentResult.mapV2Result;
  const fileSteps = v2.steps.filter((s) => s.outputType === 'files' && s.status === 'completed');
  const answerSteps = v2.steps.filter((s) => s.outputType === 'answer' && s.status === 'completed');
  const dataSteps = v2.steps.filter((s) => s.outputType === 'data' && s.status === 'completed');

  // Post answers and data as comments
  for (const step of [...answerSteps, ...dataSteps]) {
    const body = `### ${step.agent}: ${step.task}\n\n${step.output}`;
    await this.github.postIssueComment(issue.number, body);
  }

  // If there are file steps, continue to existing PR flow
  if (fileSteps.length > 0) {
    // Existing flow: scan files, run tests, commit, create PR
  } else {
    // No files to commit — mark issue as processed and return
    return;
  }
}
```

- [ ] **Step 3: Run gh-issue-pipeline tests**

Run: `cd /Users/wohlgemuth/IdeaProjects/gh-issue-pipeline && npx vitest run`
Expected: PASS (may need mock updates for v2 result shape)

- [ ] **Step 4: Fix any failing tests**

Update test mocks that construct MAP results to handle both v1 and v2 shapes.

- [ ] **Step 5: Commit**

```bash
cd /Users/wohlgemuth/IdeaProjects/gh-issue-pipeline
git add src/pipeline/issue-processor.ts
git commit -m "feat: branch post-processing by output type — answers to comments, files to PRs"
```

---

## Phase 10: Integration Test

### Task 18: End-to-End Mock Test

**Files:**
- Create: `tests/e2e/routing-mock.test.ts` (in multi-agent-pipeline)

- [ ] **Step 1: Write integration test**

```typescript
// tests/e2e/routing-mock.test.ts
import { describe, it, expect, vi } from 'vitest';
import { routeTask } from '../../src/router/router.js';
import { executeDAG } from '../../src/orchestrator/orchestrator.js';
import { buildHeadlessResultV2 } from '../../src/headless/result-builder.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';
import type { AgentAdapter } from '../../src/types/adapter.js';
import type { RouterConfig } from '../../src/types/config.js';

describe('end-to-end routing flow (mocked adapters)', () => {
  const agents = new Map<string, AgentDefinition>([
    ['researcher', {
      name: 'researcher',
      description: 'Research agent',
      adapter: 'ollama',
      model: 'gemma4',
      prompt: 'You research.',
      pipeline: [{ name: 'research' }],
      handles: 'research questions, explanations',
      output: { type: 'answer' },
      tools: [],
    }],
    ['coder', {
      name: 'coder',
      description: 'Coding agent',
      adapter: 'claude',
      prompt: 'You code.',
      pipeline: [{ name: 'execute' }],
      handles: 'code implementation, features',
      output: { type: 'files' },
      tools: [],
    }],
  ]);

  const routerConfig: RouterConfig = {
    adapter: 'ollama',
    model: 'gemma4',
    maxSteps: 10,
    timeoutMs: 30_000,
  };

  it('routes a research task to single researcher agent and produces v2 result', async () => {
    const routerResponse = '{"plan":[{"id":"step-1","agent":"researcher","task":"Explain PostgreSQL partitioning","dependsOn":[]}]}';
    const routerAdapter: AgentAdapter = {
      type: 'ollama',
      model: 'gemma4',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() { yield routerResponse; },
    };

    const plan = await routeTask('What is PostgreSQL partitioning?', agents, routerAdapter, routerConfig);
    expect(plan.plan).toHaveLength(1);
    expect(plan.plan[0].agent).toBe('researcher');

    const createAdapter = vi.fn(() => ({
      type: 'ollama' as const,
      model: 'gemma4',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() { yield 'PostgreSQL supports range, list, and hash partitioning...'; },
    }));

    const dagResult = await executeDAG(plan, agents, createAdapter);
    expect(dagResult.success).toBe(true);

    const result = buildHeadlessResultV2(plan, dagResult.steps, 5000);
    expect(result.version).toBe(2);
    expect(result.success).toBe(true);
    expect(result.steps[0].outputType).toBe('answer');
    expect(result.dag.nodes).toHaveLength(1);
    expect(result.dag.edges).toHaveLength(0);
  });

  it('routes a compound task to researcher → coder and produces v2 result', async () => {
    const routerResponse = '{"plan":[{"id":"step-1","agent":"researcher","task":"Research best practices","dependsOn":[]},{"id":"step-2","agent":"coder","task":"Implement solution","dependsOn":["step-1"]}]}';
    const routerAdapter: AgentAdapter = {
      type: 'ollama',
      model: 'gemma4',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() { yield routerResponse; },
    };

    const plan = await routeTask('Research and build a caching layer', agents, routerAdapter, routerConfig);
    expect(plan.plan).toHaveLength(2);

    let callCount = 0;
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        callCount += 1;
        if (callCount === 1) yield 'Use Redis for caching.';
        else yield 'Implemented caching layer.';
      },
    }));

    const dagResult = await executeDAG(plan, agents, createAdapter);
    expect(dagResult.success).toBe(true);

    const result = buildHeadlessResultV2(plan, dagResult.steps, 20000);
    expect(result.version).toBe(2);
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].outputType).toBe('answer');
    expect(result.steps[1].outputType).toBe('files');
    expect(result.dag.edges).toEqual([{ from: 'step-1', to: 'step-2' }]);
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `npx vitest run tests/e2e/routing-mock.test.ts`
Expected: PASS (both tests)

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: PASS (all tests including existing ones)

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/routing-mock.test.ts
git commit -m "test: add end-to-end mock test for router → orchestrator → v2 result flow"
```

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

---

## Summary

This plan delivers the core routing pipeline:

| Phase | What it builds | Key files |
|-------|---------------|-----------|
| 1 | Agent & DAG types | `src/types/agent-definition.ts`, `src/types/dag.ts` |
| 2 | Agent registry | `src/agents/loader.ts`, `src/agents/registry.ts` |
| 3 | Hermes adapter | `src/adapters/hermes-adapter.ts` |
| 4 | Config updates | `src/types/config.ts`, `src/config/schema.ts` |
| 5 | Router | `src/router/router.ts`, `src/router/prompt-builder.ts` |
| 6 | Orchestrator | `src/orchestrator/orchestrator.ts` |
| 7 | Headless v2 | `src/headless/result-builder.ts`, `src/types/headless.ts` |
| 8 | Built-in agents | `agents/coder/`, `agents/researcher/` |
| 9 | gh-issue-pipeline | `map-wrapper.ts`, `issue-processor.ts` |
| 10 | Integration test | `tests/e2e/routing-mock.test.ts` |

**Plan 2 (future)** will cover: tool system (built-in + MCP), agent creation CLI (`map agent create`), and TUI integration (router plan screen, DAG execution screen).
