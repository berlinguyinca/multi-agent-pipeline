# MAP - Multi-Agent Pipeline

**One prompt. One shot. Working software.**

MAP orchestrates AI CLIs and local models through spec-first, test-driven software delivery. It can run the original guided pipeline, or use v2 smart routing to select repo-defined agents and execute a dependency-aware DAG.

```bash
npm install -g multi-agent-pipeline
map
```

## What MAP Does

MAP supports two execution modes:

- **Classic pipeline**: spec generation, spec review, spec QA, user feedback, TDD execution, code QA, and Markdown docs.
- **Smart routing v2**: a router reads registered agents from `agents/`, creates a DAG plan, and runs independent agent steps in parallel where possible.

The core idea is the same in both modes: invest in the spec and verification path before spending expensive implementation cycles.

## Quick Start

Install dependencies and run the CLI:

```bash
npm install
npm run dev
```

Run the interactive TUI:

```bash
map
```

Run headless classic mode:

```bash
map --headless "Build a TypeScript CLI that converts CSV to JSON"
```

Run headless smart-routing mode:

```bash
map --headless --v2 "Research the best design, implement it with tests, then review readiness"
```

## Running MAP

Use `map ...` after installing the package globally. In a local checkout, use `npm run dev -- ...` with the same arguments.

### Normal Interactive Mode

Launch the TUI and type the prompt in the welcome screen:

```bash
map
```

Start the TUI with the prompt already filled in:

```bash
map "Build a REST API for task management with CRUD, auth, and pagination"
```

Use a specific config file:

```bash
map --config ./pipeline.yaml "Build a markdown-to-HTML converter"
```

Start from a GitHub issue in the TUI:

```bash
GITHUB_TOKEN=ghp_... map --github-issue https://github.com/owner/repo/issues/123
```

Resume saved checkpointed work:

```bash
map --resume
```

Normal interactive mode supports prompt text, config selection, GitHub issue input, stage-agent selection, feedback, approval, cancellation, and resume. `--personality` is currently applied by headless runners; it is not wired into the interactive TUI path yet.

### Headless Classic Mode

Classic headless mode runs the fixed spec/review/QA/execute/docs pipeline and prints JSON to stdout:

```bash
map --headless "Build a TypeScript CLI called pantry that tracks grocery items"
```

Write output to a specific directory:

```bash
map --headless --output-dir ./output/pantry "Build a pantry CLI"
```

Use runtime timeouts:

```bash
map --headless \
  --total-timeout 60m \
  --inactivity-timeout 10m \
  --poll-interval 10s \
  "Build a tested Node.js HTTP server"
```

Inject a personality or tone into all classic headless AI prompts:

```bash
map --headless \
  --personality "Be concise, skeptical, and strict about test evidence." \
  "Build a URL validator library with tests"
```

Use a GitHub issue as prompt source and post the final report back:

```bash
GITHUB_TOKEN=ghp_... map --headless \
  --github-issue https://github.com/owner/repo/issues/123
```

### Headless Smart-Routing Mode

Smart-routing mode asks the router to choose registered agents and execute a DAG:

```bash
map --headless --v2 "Add a feature, write tests, review code quality, and update docs"
```

Use a custom config and personality:

```bash
map --headless --v2 \
  --config ./pipeline.yaml \
  --personality "Prefer small diffs, explicit risks, and no new dependencies." \
  "Investigate the bug, add a regression test, fix it, and assess release readiness"
```

The v2 result JSON includes per-step results and a DAG summary. V2 uses `router` config plus enabled agents from `agents/`; it does not use the fixed `agents.spec/review/qa/execute/docs` stage assignments except where those assignments are relevant to classic mode.

### Agent Commands

Inspect registered agents:

```bash
map agent list
```

Validate one agent:

```bash
map agent test implementation-coder
```

Generate a new agent definition:

```bash
map agent create --adapter ollama --model gemma4:26b
```

### Local Development Equivalents

From this repository, prefix the same commands with `npm run dev --`:

```bash
npm run dev -- --headless --v2 \
  --personality "Use a terse engineering review style." \
  "Build the feature with TDD and QA review"
```

```bash
npm run dev -- agent list
```

## Supported Backends

| Backend | Install | Notes |
| --- | --- | --- |
| Claude CLI | `npm install -g @anthropic-ai/claude-code` | Strong default for spec generation, implementation, and docs. |
| Codex CLI | `npm install -g @openai/codex` | Good for review, QA, and analysis. |
| Ollama | `curl -fsSL https://ollama.com/install.sh \| sh` | Local model backend. MAP can start the server and pull/update configured models before use. |
| Hermes | Install Hermes CLI and keep `hermes` on `PATH` | Optional adapter for `hermes chat -q ... -Q` workflows. |

For Ollama-backed agents, `model` is required. If an Ollama-backed stage or v2 agent runs and the server is not available, MAP starts `ollama serve` in the background, waits for it to respond, then runs `ollama pull <model>`. Pulling installs a missing model and refreshes an existing tag. MAP does this once per distinct model/host per process run.

## Classic Pipeline

Classic mode follows the fixed stage machine:

```text
prompt
  -> spec
  -> review
  -> spec QA
  -> feedback/approval loop
  -> TDD execution
  -> code QA/fix loop
  -> docs
  -> complete
```

The stage assignments come from `pipeline.yaml`:

```yaml
agents:
  spec:
    adapter: claude
  review:
    adapter: codex
  qa:
    adapter: codex
  execute:
    adapter: claude
  docs:
    adapter: claude

ollama:
  host: http://localhost:11434

quality:
  maxSpecQaIterations: 3
  maxCodeQaIterations: 3

outputDir: ./output
gitCheckpoints: true
```

The QA agent is used twice:

- After review, it checks whether the spec is complete enough to execute.
- After implementation, it checks generated code, tests, docs, maintainability, and spec conformance.

Failed spec QA loops back to spec/review. Failed code QA sends findings to the execute agent until `quality.maxCodeQaIterations` is reached.

## Refinement Score

The refinement score answers whether a reviewed spec is ready for one-shot execution. Review output includes component scores for completeness, testability, and specificity, then combines them into a 0-100 score.

Use the score as a planning signal:

- Low score: add feedback or clarify requirements before execution.
- Improving score: keep iterating on the spec.
- High or plateaued score: approve and execute.

The feedback loop is intentionally cheaper than implementation retries: MAP iterates on the spec until the acceptance criteria are concrete enough to drive TDD.

## Smart Routing v2

Smart routing turns a user task into a DAG of named agents:

```text
prompt
  -> router
  -> DAG plan
  -> orchestrator
  -> agent steps, parallel where dependencies allow
  -> v2 result
```

Run it with:

```bash
map --headless --v2 "Build a feature, write tests, update docs, and assess release readiness"
```

The router uses the registered agents' `name`, `description`, `handles`, and `output.type` to produce JSON:

```json
{
  "plan": [
    { "id": "step-1", "agent": "spec-writer", "task": "Create an implementation-ready specification", "dependsOn": [] },
    { "id": "step-2", "agent": "tdd-engineer", "task": "Write failing tests", "dependsOn": ["step-1"] },
    { "id": "step-3", "agent": "implementation-coder", "task": "Implement the behavior", "dependsOn": ["step-2"] }
  ]
}
```

Steps with no unmet dependencies run concurrently. Dependent steps receive previous step outputs as context. If a dependency fails, downstream steps are skipped with a clear reason.

## Agent Registry

Agents live in git under `agents/<name>/`:

```text
agents/
  spec-writer/
    agent.yaml
    prompt.md
  implementation-coder/
    agent.yaml
    prompt.md
```

Each `agent.yaml` declares runtime configuration and routing metadata:

```yaml
name: implementation-coder
description: "Implements the smallest code change needed to satisfy failing tests and reviewed specs"
adapter: ollama
model: gemma4:26b
prompt: prompt.md
pipeline:
  - name: inspect-tests
  - name: write-code
  - name: refactor
handles: "code implementation, feature work, bug fixes, test fixes, minimal diffs"
output:
  type: files
tools:
  - type: builtin
    name: shell
```

Supported output types:

| Type | Meaning |
| --- | --- |
| `answer` | Text analysis or recommendation. |
| `data` | Structured data result. |
| `files` | Creates or modifies project files. |

Supported tool declarations:

- `builtin: shell` for bounded shell command access.
- `builtin: file-read` for file reads with path traversal protection.
- `mcp` for future MCP-backed tool catalogs.

Deployment overrides live in `pipeline.yaml` under `agentOverrides`. Scalar fields replace the agent definition; tools are merged by name.

```yaml
agentOverrides:
  implementation-coder:
    model: qwen2.5-coder:14b
  docs-maintainer:
    enabled: false
```

## Built-In Agents

PR #1 added a software delivery bundle. These agents default to `adapter: ollama` and `model: gemma4:26b`:

| Agent | Output | Handles |
| --- | --- | --- |
| `software-delivery` | `files` | Full spec -> QA -> TDD -> implementation -> code QA lifecycle. |
| `spec-writer` | `answer` | Requirements, acceptance criteria, constraints, implementation-ready specs. |
| `spec-qa-reviewer` | `answer` | Spec ambiguity, missing tests, edge cases, implementation risk. |
| `tdd-engineer` | `files` | Test plans and failing tests from acceptance criteria. |
| `implementation-coder` | `files` | Minimal code changes that satisfy tests and reviewed specs. |
| `code-qa-analyst` | `answer` | Code QA, maintainability, test adequacy, spec conformance. |
| `bug-debugger` | `answer` | Reproduction, root cause, regression-safe fix plans. |
| `build-fixer` | `files` | Build, typecheck, lint, and toolchain failures. |
| `test-stabilizer` | `files` | Flaky, brittle, missing, or low-signal tests. |
| `refactor-cleaner` | `files` | Behavior-preserving cleanup using existing patterns. |
| `docs-maintainer` | `files` | Markdown docs updates after implementation and QA. |
| `release-readiness-reviewer` | `answer` | Final readiness, evidence, risk, and handoff status. |

Example DAG flows are documented in [docs/agents/software-delivery-flows.md](docs/agents/software-delivery-flows.md).

## Agent CLI

Agent definitions can be inspected and generated from the CLI:

```bash
map agent list
map agent test implementation-coder
map agent create --adapter ollama --model gemma4:26b
```

`map agent list` loads `agents/` and prints each agent's adapter, model, output type, pipeline, and tool count.

`map agent test <name>` validates the agent definition and prints its routing metadata.

`map agent create` asks what the agent should do, calls the configured agent-creation adapter, and writes `agents/<name>/agent.yaml` plus `prompt.md`. Review generated files before committing them.

## GitHub Issue Mode

Headless mode can use a GitHub issue as the source prompt and post one final report back to the issue:

```bash
GITHUB_TOKEN=ghp_... map --headless --github-issue https://github.com/owner/repo/issues/123
```

The issue title, body, and non-bot comments become the task prompt. If you also pass prompt text, MAP appends it as additional instructions. The final comment includes the generated spec, QA assessments, execution summary, files created, Markdown docs updated, test counts, and failure details when applicable.

## Checkpoints And Resume

MAP uses git checkpoints at stage boundaries. Cancelling with `Ctrl+C` saves progress so a pipeline can be resumed later.

```bash
map --resume
```

You can also press `Ctrl+O` on the welcome screen to browse saved checkpoints. When resuming, MAP can keep the original stage assignments or use the current configuration, which is useful when switching from a local model to a stronger backend after a failed or incomplete run.

## Configuration Reference

MAP loads config in this order:

1. `--config <path>`
2. `pipeline.yaml` in the current directory
3. `~/.map/pipeline.yaml`
4. Built-in defaults

Full example:

```yaml
agents:
  spec:
    adapter: claude
  review:
    adapter: codex
  qa:
    adapter: ollama
    model: qwen:latest
  execute:
    adapter: claude
  docs:
    adapter: ollama
    model: gemma4:26b

router:
  adapter: ollama
  model: gemma4:26b
  maxSteps: 10
  timeoutMs: 30s

agentCreation:
  adapter: ollama
  model: gemma4:26b

agentOverrides:
  implementation-coder:
    model: qwen2.5-coder:14b
  release-readiness-reviewer:
    enabled: true

ollama:
  host: http://localhost:11434

quality:
  maxSpecQaIterations: 3
  maxCodeQaIterations: 3

headless:
  totalTimeoutMs: 60m
  inactivityTimeoutMs: 10m
  pollIntervalMs: 10s

outputDir: ./output
gitCheckpoints: true
```

## CLI Reference

```text
Usage:
  map                    Launch interactive TUI
  map "your idea"        Start pipeline with a prompt
  map --resume [id]      Resume a saved pipeline
  map --config <path>    Use custom config file
  map --headless "idea"  Run non-interactively, outputs JSON to stdout
  map --headless --v2 "idea"
                         Run smart-routing DAG mode
  map --github-issue <url>
                         Use a GitHub issue as prompt and post final report
  map agent list         List registered agents
  map agent create       Generate a new agent definition
  map agent test <name>  Validate and inspect one agent

Options:
  --help, -h             Show help
  --version, -v          Show version
  --config <path>        Path to pipeline.yaml config
  --resume [id]          Resume a saved pipeline
  --headless             Run without TUI, print JSON result to stdout
  --v2                   Use DAG-based smart routing in headless mode
  --output-dir <path>    Output directory for generated projects
  --total-timeout <dur>  Total headless runtime budget, e.g. 60m
  --inactivity-timeout <dur>
                         Stall timeout since last stage activity, e.g. 10m
  --poll-interval <dur>  Internal polling cadence for timeout checks, e.g. 10s
  --github-issue <url>   GitHub issue URL for prompt/reporting
  --personality <text>   Personality or tone injected into AI prompts
```

## TUI Notes

The TUI supports:

- Agent assignment for classic pipeline stages.
- GitHub issue URL entry on the welcome screen.
- Spec feedback loop with reviewed spec and refinement score.
- Execution progress, code QA/fix loops, and final docs progress.
- Router plan and DAG execution screens for v2 UI surfaces as the routing experience continues to mature.

Keyboard shortcuts:

| Screen | Key | Action |
| --- | --- | --- |
| Welcome | `Tab` | Select stage for agent assignment |
| Welcome | `Enter` | Start pipeline or change agent |
| Welcome | `Ctrl+O` | Open saved pipelines |
| Pipeline | `Ctrl+C` | Cancel and save checkpoint |
| Feedback | `Enter` | Submit feedback and refine spec |
| Feedback | `Ctrl+E` | Approve and execute |
| Feedback | `Tab` | Toggle spec/diff view |
| Complete | `Enter` | Start a new pipeline |
| Complete | `o` | Open output directory |

## Architecture

Important directories:

```text
src/
  adapters/       AI backend wrappers: Claude, Codex, Ollama, Hermes
  agents/         Agent loader and registry
  checkpoint/     Git checkpoint save/resume support
  cli/            Agent CLI commands and creation dialog
  config/         YAML config loading, defaults, validation
  github/         GitHub issue fetch/reporting helpers
  headless/       Headless classic and v2 runners
  orchestrator/   DAG execution engine
  pipeline/       Classic XState pipeline
  prompts/        System prompt builders
  router/         LLM router prompt and DAG parsing
  tools/          Built-in tool registry and prompt injection
  tui/            Ink/React terminal UI
  types/          Shared TypeScript contracts
  utils/          Duration, error, logging, platform helpers

agents/           Git-tracked runtime agent definitions
docs/agents/      Agent-flow documentation
```

Core contracts:

- `AgentAdapter` streams output from each backend and supports cancellation.
- `AgentDefinition` describes a routable agent, its prompt, pipeline, tools, and output type.
- `DAGPlan` is router-produced JSON with `id`, `agent`, `task`, and `dependsOn`.
- `StepResult` records per-step status, output, duration, files, and errors.
- `HeadlessResultV2` includes step results and a graph-friendly DAG summary.

Classic state machine:

```text
idle -> specifying -> reviewing -> specAssessing
                   ^                |
                   +-- spec QA fail-+
specAssessing -> feedback -> executing -> codeAssessing
                                     |        |
                                     |        +-- code QA fail -> fixing -> codeAssessing
                                     +-- pass -> documenting -> complete
```

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

Current verification baseline after PR #1:

- `npm test`: 70 test files, 393 tests
- `npm run typecheck`
- `npm run build`

## Roadmap

The v2 foundation is now in place. Useful next steps:

- Token usage tracking per stage and per DAG step.
- Retry/failover policies for quota or transient backend failures.
- Mid-stage resume instead of only stage-boundary checkpoints.
- Additional built-in tools and MCP-backed tool execution.
- Full interactive v2 approval/editing flow in the TUI.
- Browser-based UI for long-running pipelines.

## License

MIT
