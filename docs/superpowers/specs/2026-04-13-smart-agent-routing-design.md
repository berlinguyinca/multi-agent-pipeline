# Smart Agent Routing: DAG-Based Dynamic Pipeline

## Overview

Transform MAP from a fixed linear pipeline (spec → review → QA → execute → docs) into a dynamic, task-aware routing system. An LLM classifier analyzes incoming prompts and composes a DAG of named agents — each with its own pipeline, tools, and output type. Agents are git-tracked, LLM-assisted to create, and composable for compound tasks.

## Motivation

MAP currently treats every task as "write code." A research question, a database query, and a feature request all go through the same spec-to-code lifecycle. This wastes time and produces wrong-shaped outputs. GitHub issues processed by `gh-issue-pipeline` naturally vary — feature requests, questions, data tasks, analysis requests — and the pipeline should handle each appropriately.

## Architecture

### Core Concepts

**Agent** — the fundamental unit. A named, self-contained definition with:
- System prompt (markdown file)
- Adapter + model selection
- Tool access (built-in + MCP)
- Pipeline stages (ordered list, each optionally with its own prompt)
- Output type declaration
- Natural-language `handles` description (read by the router)

**Router** — an LLM classifier that reads all registered agents and produces a DAG plan for the incoming task.

**DAG Orchestrator** — executes the plan: runs agents in parallel where possible, passes data between dependent steps, collects per-step results.

### Flow

```
User prompt / GitHub issue
       ↓
  Router LLM (cheap/fast, default: ollama/gemma4)
       ↓
  DAG Plan (which agents, what order, dependencies)
       ↓
  Orchestrator
       ↓
  ┌──────────┐  ┌──────────┐
  │ Agent A   │  │ Agent B   │  ← parallel if independent
  │ (stages)  │  │ (stages)  │
  └────┬──────┘  └────┬──────┘
       └──────┬───────┘
              ↓
        ┌──────────┐
        │ Agent C   │  ← depends on A and B
        │ (stages)  │
        └──────────┘
              ↓
        Aggregated Result
```

---

## 1. Agent Registry

### Directory Structure

Each agent is a self-contained directory in the repo under `agents/`:

```
agents/
  coder/
    agent.yaml
    prompt.md
    stages/
      spec.md
      review.md
      qa.md
      execute.md
      docs.md
  researcher/
    agent.yaml
    prompt.md
  database/
    agent.yaml
    prompt.md
    stages/
      validate-query.md
      format-results.md
  financial/
    agent.yaml
    prompt.md
  sec-analyst/
    agent.yaml
    prompt.md
    stages/
      analyze.md
```

### agent.yaml Schema

```yaml
name: database
description: "Executes and explains database queries"
adapter: claude
model: sonnet
prompt: prompt.md                    # relative to agent dir
tools:
  - type: builtin
    name: db-connection
    config:
      dialect: postgres
  - type: mcp
    uri: "mcp://localhost:5432/pg-tools"
pipeline:
  - name: validate-query
    prompt: stages/validate-query.md  # optional per-stage prompt override
  - name: execute                     # uses main prompt.md
  - name: format-results
    prompt: stages/format-results.md
handles: "SQL queries, database schema, data retrieval, query optimization"
output:
  type: data                          # answer | data | files
```

### Output Types

Each agent declares what it produces:

| Type | Meaning | Headless consumer action |
|------|---------|--------------------------|
| `answer` | Text response | Post as comment on GitHub issue |
| `data` | Structured data | Format and include in report |
| `files` | Created/modified files | Commit, create PR, run tests |

### Prompt Files

The `prompt` field in `agent.yaml` references a markdown file relative to the agent directory. Prompts are rich, expressive markdown documents:

```markdown
# Database Agent

You are a database specialist working with PostgreSQL databases.

## Capabilities
- Write and optimize SQL queries
- Explain query execution plans
...

## Safety Rules
- NEVER execute DROP, TRUNCATE, or DELETE without explicit confirmation
...

## Output Format
Return results as markdown tables when possible.
```

Stages without a `prompt` override inherit the agent's main prompt.

### Deployment Overrides (pipeline.yaml)

`pipeline.yaml` references agents from `agents/` and adds local deployment config:

```yaml
router:
  adapter: ollama
  model: gemma4
  maxSteps: 10
  timeout: 30s

agentCreation:
  adapter: ollama
  model: gemma4

agents:
  coder:                              # uses agents/coder/ as-is
  researcher:                         # uses agents/researcher/ as-is
  database:
    model: opus                       # override model for this deployment
    tools:
      - type: builtin
        name: db-connection
        config:
          dialect: postgres
          host: localhost:5432        # local connection config
  financial:
    enabled: false                    # disable for this project
```

Agent definitions (prompts, stages, capabilities) live in git under `agents/`. Deployment config (model overrides, tool connection strings, enabled/disabled) lives in `pipeline.yaml`. Community maintains agent logic; each user configures their environment.

### Backwards Compatibility

The existing v0.1 `spec/review/qa/execute/docs` stage assignments become the `coder` agent. The current `pipeline.yaml` agent config shape remains valid as a shorthand when only one agent is needed and no routing is desired.

---

## 2. Router & DAG Planner

### Classification

When a task arrives, the router LLM:

1. Reads all registered agents — their names, descriptions, and `handles` text
2. Analyzes the incoming prompt
3. Produces a DAG plan as structured JSON

The router prompt is auto-generated from the agent registry. No manual maintenance when agents change.

### Router Configuration

```yaml
router:
  adapter: ollama
  model: gemma4
  maxSteps: 10          # cap on DAG complexity
  timeout: 30s          # router should be fast
```

Overridable from CLI: `map --router-model claude/haiku`

### DAG Plan Format

```json
{
  "plan": [
    {
      "id": "step-1",
      "agent": "researcher",
      "task": "Research PostgreSQL partitioning strategies",
      "dependsOn": []
    },
    {
      "id": "step-2",
      "agent": "database",
      "task": "Design partition schema based on research",
      "dependsOn": ["step-1"]
    },
    {
      "id": "step-3",
      "agent": "coder",
      "task": "Implement migration scripts for the partition schema",
      "dependsOn": ["step-2"]
    }
  ]
}
```

- `dependsOn: []` means "can run immediately"
- Steps with no mutual dependencies run in parallel
- Each step gets a scoped task description — the router breaks the prompt into sub-tasks
- Single-agent tasks are a DAG with one node (no special case)

### TUI Approval

In TUI mode, the DAG plan is shown before execution. User can approve, edit, or cancel. In headless mode, auto-approved (same pattern as today's spec auto-approve).

---

## 3. DAG Orchestrator

### Parallel Execution

Steps with no unmet dependencies run concurrently:

```
step-1 (researcher) ──┐
                       ├──→ step-3 (coder)
step-2 (database)  ───┘
```

Steps 1 and 2 run in parallel. Step 3 waits for both.

### Data Passing

When a step depends on previous steps, its prompt is augmented with those outputs:

```
Your task: "Design partition schema based on research"

--- Context from previous steps ---

[step-1: researcher]
<researcher's output here>
```

### Per-Step Lifecycle

Each agent runs through its own pipeline stages. The `database` agent goes through `validate-query → execute → format-results`. The `coder` agent goes through `spec → review → qa → execute → code-qa → docs`. Each agent's stages are self-contained.

### Error Handling

- If a step fails, steps that depend on it are skipped
- Completed steps still have value — partial results are reported
- Per-step status is included in the output

### Timeouts

Each step inherits the agent's timeout or the global default. The orchestrator also enforces a total DAG timeout.

---

## 4. Tool System

### Built-in Tools

| Tool | Purpose | Config |
|------|---------|--------|
| `shell` | Execute commands in a sandbox | `allowedCommands`, `workingDir` |
| `http-api` | Call REST/GraphQL endpoints | `baseUrl`, `headers`, `auth` |
| `db-connection` | Execute SQL queries | `dialect`, `host`, `credentials` |
| `file-read` | Read files from working directory | `allowedPaths` |

### Tool Interface

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute(params: unknown): Promise<ToolResult>;
}
```

### MCP Tools

```yaml
tools:
  - type: mcp
    uri: "mcp://localhost:8080/financial-tools"
```

MAP discovers the MCP server's tools at startup and includes their descriptions in the agent's context. The agent calls them by name; MAP proxies to the MCP server.

### Tool Injection

Available tools are appended to the agent's system prompt as a tool catalog (names, descriptions, parameter schemas). The agent's LLM decides when and how to use them. Standard tool-use pattern.

### Security

- Built-in tools have configurable guardrails (allowed commands, allowed paths, read-only mode)
- `db-connection` defaults to read-only unless explicitly configured otherwise
- MCP tools inherit whatever the MCP server exposes

---

## 5. Adapter System

### Supported Adapters

| Adapter | Binary | Detection | Invocation | Key Flags |
|---------|--------|-----------|------------|-----------|
| `claude` | `claude` | `claude --version` | `claude --permission-mode bypassPermissions --print <prompt>` | |
| `codex` | `codex` | `codex --version` | `codex exec --skip-git-repo-check <prompt>` | |
| `ollama` | `ollama` | HTTP to localhost:11434 | HTTP API | model selection |
| `hermes` | `hermes` | `hermes --version` | `hermes chat -q "<prompt>" -Q` | `--model`, `--toolsets`, `--yolo`, `--max-turns`, `-s` |

### Hermes Adapter

Hermes Agent by Nous Research is the fourth adapter. Key capabilities:

- **Non-interactive mode**: `hermes chat -q "<prompt>" -Q` (quiet/programmatic)
- **Model flexibility**: `--model anthropic/claude-sonnet-4` — supports any provider (OpenRouter, Anthropic, OpenAI, etc.)
- **Built-in tools**: 40+ tools available via `--toolsets "web,terminal,skills"` — agents using Hermes get these for free
- **Skills preloading**: `-s skill-name` for specialized behavior
- **Approval bypass**: `--yolo` for unattended execution
- **Iteration cap**: `--max-turns N`

### Pluggable Architecture

Adding a new adapter requires implementing the `AgentAdapter` interface and registering it in the adapter factory. No core code changes needed.

```typescript
interface AgentAdapter {
  type: AdapterType;
  model?: string;
  detect(): Promise<DetectInfo>;
  run(prompt: string, options?: RunOptions): AsyncGenerator<string>;
  cancel(): void;
}
```

---

## 6. Agent Creation CLI

### Command

```
map agent create [--adapter ollama] [--model gemma4]
```

### Flow

An LLM-assisted interactive dialog using a cheap/fast model (default: ollama/gemma4, configurable):

1. **"What should this agent do?"** — user describes the agent's purpose in natural language
2. **"What should we call it?"** — short name for config/routing
3. **"Which adapter?"** — from detected available adapters
4. **"Which model?"** — model selection
5. **"Does it need tools?"** — LLM suggests based on description, user confirms/edits
6. **"What pipeline stages?"** — LLM suggests stages, user confirms/edits
7. **Generate** — LLM writes prompt.md and per-stage prompts
8. **Write** — saves to `agents/<name>/` directory
9. **Review** — user can inspect and edit before committing

### Configuration

```yaml
agentCreation:
  adapter: ollama
  model: gemma4
```

Overridable from CLI: `map agent create --adapter claude --model haiku`

### Additional Commands

- `map agent list` — show all registered agents with descriptions
- `map agent edit <name>` — open agent's prompt in editor
- `map agent test <name>` — run agent with a sample prompt to verify it works

---

## 7. TUI Integration

### Router Plan Screen

After prompt submission, show the DAG plan before execution:

```
┌─────────────────────────────────────────┐
│ Router Plan                             │
│                                         │
│ ┌───────────┐   ┌───────────┐          │
│ │ researcher │──→│   coder   │          │
│ │  step-1    │   │  step-2   │          │
│ └───────────┘   └───────────┘          │
│                                         │
│ step-1: Research partitioning strategies│
│   agent: researcher (haiku)             │
│   pipeline: research → summarize        │
│                                         │
│ step-2: Implement migration scripts     │
│   agent: coder (opus)                   │
│   pipeline: spec → review → qa →        │
│            execute → code-qa → docs     │
│   depends on: step-1                    │
│                                         │
│ [Execute] [Edit Plan] [Cancel]          │
└─────────────────────────────────────────┘
```

### Execution Screen

During DAG execution, show parallel progress:

```
┌─────────────────────────────────────────┐
│ Executing Plan                          │
│                                         │
│ step-1 [researcher] ██████████░░ 80%    │
│   → research (done) → summarize (running)│
│                                         │
│ step-2 [coder]      ⏳ waiting on step-1│
│                                         │
│ step-3 [database]   ████████████ done   │
└─────────────────────────────────────────┘
```

### Adaptation

- Agents with QA stages still show the Refinement Score
- Agents without QA stages skip it
- Completion screen aggregates results by output type

---

## 8. Headless Output Contract

### Current Contract (v1)

```json
{
  "version": 1,
  "success": true,
  "spec": "...",
  "filesCreated": ["..."],
  "error": "..."
}
```

### New Contract (v2)

```json
{
  "version": 2,
  "success": true,
  "dag": {
    "nodes": [
      { "id": "step-1", "agent": "researcher", "status": "completed", "duration": 12400 },
      { "id": "step-2", "agent": "coder", "status": "completed", "duration": 94300 }
    ],
    "edges": [
      { "from": "step-1", "to": "step-2" }
    ]
  },
  "steps": [
    {
      "id": "step-1",
      "agent": "researcher",
      "task": "Research partitioning strategies",
      "status": "completed",
      "outputType": "answer",
      "output": "PostgreSQL supports three partitioning methods...",
      "pipeline": [
        { "stage": "research", "status": "completed", "duration": 8100 },
        { "stage": "summarize", "status": "completed", "duration": 4300 }
      ]
    },
    {
      "id": "step-2",
      "agent": "coder",
      "task": "Implement migration scripts",
      "status": "completed",
      "outputType": "files",
      "output": "Implemented 3 migration files...",
      "filesCreated": ["migrations/001_partition.sql", "migrations/002_indexes.sql"],
      "pipeline": [
        { "stage": "spec", "status": "completed", "duration": 12000 },
        { "stage": "review", "status": "completed", "duration": 8000 },
        { "stage": "qa", "status": "completed", "duration": 6000 },
        { "stage": "execute", "status": "completed", "duration": 45000 },
        { "stage": "code-qa", "status": "completed", "duration": 15000 },
        { "stage": "docs", "status": "completed", "duration": 8300 }
      ]
    }
  ],
  "error": null
}
```

Key additions:
- `version: 2` — clean version bump for compatibility detection
- `dag.nodes` + `dag.edges` — machine-readable graph structure for rendering by external tools
- `steps[]` — per-step detail with `outputType`, `status`, `pipeline` trace
- Each step has its own `outputType` so the consumer knows how to handle it

### gh-issue-pipeline Integration

`gh-issue-pipeline` reads the v2 contract and branches post-processing per step:

- `outputType: "files"` — commit files, create PR, run tests (current behavior)
- `outputType: "answer"` — post as comment on the GitHub issue
- `outputType: "data"` — format as markdown table/block and post as comment

The `dag` field is available for debugging — `gh-issue-pipeline` can include the graph structure in its status comment or pass it to a rendering tool.

---

## gh-issue-pipeline Changes Required

### map-wrapper.ts

Current contract parsing (version 1) needs to support version 2:

1. **Version check**: Accept `version: 1` (legacy) or `version: 2` (new)
2. **V2 parsing**: Extract per-step results from `steps[]`
3. **Output type routing**: Return step output types so issue-processor can branch

### issue-processor.ts

Post-MAP processing needs to handle mixed output types:

1. **Files steps**: Existing flow — scan filesystem, run tests, commit, create PR
2. **Answer steps**: Post answer text as comment on the issue
3. **Data steps**: Format data and post as comment
4. **Mixed DAGs**: A single task may produce both files (→ PR) and answers (→ comment)

### Type changes

```typescript
interface MAPResultPayload {
  version: 1 | 2;
  success: boolean;
  // v1 fields (backwards compat)
  spec?: string;
  filesCreated?: string[];
  // v2 fields
  dag?: {
    nodes: Array<{ id: string; agent: string; status: string; duration: number }>;
    edges: Array<{ from: string; to: string }>;
  };
  steps?: Array<{
    id: string;
    agent: string;
    task: string;
    status: string;
    outputType: 'answer' | 'data' | 'files';
    output: string;
    filesCreated?: string[];
    pipeline: Array<{ stage: string; status: string; duration: number }>;
  }>;
  error?: string | null;
}
```
