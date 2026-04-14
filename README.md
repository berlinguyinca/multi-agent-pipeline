# MAP - Multi-Agent Pipeline

**One prompt. One shot. Working software.**

MAP orchestrates multiple AI tools (Claude, Codex, Ollama) through an iterative spec-refinement pipeline that produces working, test-driven, documented code from a natural language prompt. Instead of burning tokens on implementation retries, MAP invests in spec quality upfront so the execution stage produces working code on the first attempt.

```
npm install -g multi-agent-pipeline
map
```

---

## How It Works

MAP follows a 4-stage pipeline with spec and code QA gates:

```
User Prompt
    |
    v
+------------------+
| Stage 1: SPEC    |  AI agent generates a structured specification
| (generation)     |  from your natural language prompt
+--------+---------+
         |
         v
+------------------+
| Stage 2: REVIEW  |  A different AI agent reviews the spec,
| (validation)     |  finds gaps, and produces an improved version
+--------+---------+
         |
         v
+--------------------------------------+
| FEEDBACK LOOP                        |
| You review the spec in the TUI.      |
| Options:                             |
|   * Approve --> proceed to execution |
|   * Add suggestions --> re-enter     |
|     Stage 1 with feedback, refine,   |
|     and re-review                    |
|   * Cancel --> save checkpoint, exit |
+--------+-----------------------------+
         | (approved)
         v
+------------------+
| Stage 3: EXECUTE |  AI agent implements with strict TDD:
| (implementation) |  1. Write failing tests from acceptance criteria
|                  |  2. Implement code to pass all tests
|                  |  3. Refactor
|                  |  Output: working project with passing tests
+--------+---------+
         |
         v
+------------------+
| Stage 4: DOCS    |  AI agent updates Markdown documentation
| (documentation)  |  from the executed project and QA results
|                  |  Output: runnable project with current docs
+------------------+
```

The key insight: **iterate on the spec, not on the code**. Each refinement cycle costs a fraction of what a failed implementation retry would cost. By the time you approve the spec for execution, it's precise enough for one-shot success.

---

## Quick Start

### Prerequisites

You need at least one AI CLI tool installed:

| Tool | Install | Used for |
|------|---------|----------|
| **Claude** | `npm install -g @anthropic-ai/claude-code` | Spec generation, execution, documentation |
| **Codex** | `npm install -g @openai/codex` | Spec review, QA |
| **Ollama** | [ollama.com/download](https://ollama.com/download) | Any stage (local models) |

### Install MAP

```bash
npm install -g multi-agent-pipeline
```

### Your First Pipeline

```bash
map
```

This launches the interactive TUI. You'll see:

1. **Agent configuration** showing which tools are installed
2. **A prompt input** where you describe what you want to build
3. Type your idea and press Enter

MAP will generate a spec, have it reviewed and QA checked, show you the result, and let you approve or refine before executing, code QA, and final Markdown documentation.

---

## TUI Walkthrough

### Screen 1: Welcome & Configuration

```
  MAP   Multi-Agent Pipeline
        One prompt. One shot. Working software.

  Agent Configuration

  STAGE       AGENT           STATUS
  * Spec      claude          installed
  * Review    codex           installed
  * QA        codex           installed
  * Execute   claude          installed
  * Docs      claude          installed

  Available agents:
  +-- claude          (installed)
  +-- codex           (installed)
  +-- ollama
      +-- deepseek-coder:latest
      +-- hermes:latest
      +-- codellama:13b

  What would you like to build?
  > _

  [Enter] Start   [Ctrl+O] Resume saved   [?] Help
```

On launch, MAP auto-detects installed binaries and lists available Ollama models. Use **Tab** to select a stage, **Enter** to change its agent. Type your idea at the bottom and press Enter to start.

### Screen 2: Pipeline Execution

```
  MAP Pipeline                              Iteration 1

  * Spec ====== o Review ------ o Execute
  claude         codex           claude
  ========== 78%

  --- Spec Generation (claude) ---

  # REST API for Task Management

  ## Goal
  Build a RESTful API with CRUD endpoints...

  ## Acceptance Criteria
  - [ ] POST /tasks creates a task
  - [ ] GET /tasks returns paginated list
  ...  (streaming...)

  [Ctrl+C] Cancel & save checkpoint
```

Watch the spec being generated in real-time. The pipeline bar at the top shows progress across all stages.

### Screen 3: Feedback Loop (The Heart of MAP)

```
  MAP Pipeline                              Iteration 2

  REFINEMENT SCORE

    Iteration 1:  ========..........  45%
    Iteration 2:  =============.....  72%  <- now

    Target: ==================..  90% (one-shot)

  --- Reviewed Spec (v2) ---

  # REST API for Task Management (v2)
  ## Acceptance Criteria
  - [ ] POST /tasks creates a task with validated input
  - [ ] GET /tasks returns cursor-paginated list
  - [ ] Rate limiting: 100 req/min per user
  ... (scroll for more)

  --- Your Feedback ---
  > Add error response schemas with consistent JSON format_

  [Enter] Refine again   [Ctrl+E] Approve & Execute
```

This is where the magic happens:

- **Refinement Score** shows how the spec improves across iterations
- **Spec viewer** displays the current reviewed spec (toggle diff view with **Tab**)
- **Chat input** lets you type feedback in natural language
- Press **Enter** to refine again, or **Ctrl+E** when you're confident the spec is ready

### Screen 4: TDD Execution

```
  Phase: RED (writing failing tests)

  tests/tasks.test.ts
  +-- written: POST /tasks creates a task
  +-- written: GET /tasks returns paginated list
  +-- writing: PUT /tasks/:id updates...
  +-- pending: DELETE /tasks/:id
  +-- pending: Auth middleware

  Tests: 3 written | 0 passing | 3 failing | 2 pending
```

The execution screen shows strict TDD in action:
- **RED** phase: writing failing tests from acceptance criteria
- **GREEN** phase: implementing code to pass tests
- **REFACTOR** phase: cleaning up while keeping tests green

After execution, MAP runs code QA. If QA finds gaps, the execute agent receives the findings and fixes the generated project until the configured code QA limit is reached. When code QA passes, the docs agent updates Markdown documentation from the final project state.

### Screen 5: Success

```
  ONE-SHOT SUCCESS

  Spec iterations:  3
  Tests generated:  6 (6 passing)
  Files created:    8
  Docs updated:      README.md, docs/usage.md
  Pipeline time:    4m 32s

  Generated project: ./output/task-api/
  Run tests: cd output/task-api && npm test

  [Enter] New pipeline   [o] Open project   [Ctrl+C] Exit
```

---

## Configuration

MAP looks for configuration in this order:
1. Path passed via `--config`
2. `pipeline.yaml` in the current directory
3. `~/.map/pipeline.yaml`
4. Built-in defaults

### pipeline.yaml

```yaml
# Agent assignment per pipeline stage
agents:
  spec:
    adapter: claude          # claude | codex | ollama
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

# Output directory for generated projects
outputDir: ./output

# Auto-commit at stage boundaries for cancel/resume
gitCheckpoints: true
```

### Using Ollama Models

You can assign different Ollama models to different stages:

```yaml
agents:
  spec:
    adapter: ollama
    model: deepseek-coder:latest    # Good at understanding requirements
  review:
    adapter: ollama
    model: hermes:latest            # Good at critical analysis
  qa:
    adapter: ollama
    model: qwen:latest              # Good at quality assessment
  execute:
    adapter: ollama
    model: codellama:13b            # Good at code generation
  docs:
    adapter: ollama
    model: llama3:latest            # Good at concise documentation

ollama:
  host: http://localhost:11434       # Override for remote Ollama servers
```

The `model` field is **required** when `adapter` is `ollama` and is ignored for other adapters.
The `qa` agent runs after spec review and after implementation. Failed spec QA feeds findings back into another spec/review pass; failed code QA sends findings back to the execute agent for fixes until the configured quality limits are reached. The `docs` agent runs last and may create or update Markdown files only.

### GitHub Issue Input and Reporting

MAP can use a GitHub issue as the source prompt and post one final report back to the issue:

```bash
GITHUB_TOKEN=ghp_... map --headless --github-issue https://github.com/owner/repo/issues/123
```

The issue title, body, and non-bot comments become the build prompt. If you also provide prompt text, MAP appends it as additional instructions. The final issue comment includes the generated spec, QA assessments, execution summary, files created, Markdown docs updated, test counts, and failure details when applicable.

The TUI also exposes a separate optional GitHub issue URL field on the welcome screen. `GITHUB_TOKEN` must be available in the environment for issue fetch and final comment posting.

### Mixing Cloud and Local

```yaml
agents:
  spec:
    adapter: claude                 # Cloud: strong at spec writing
  review:
    adapter: ollama
    model: hermes:latest            # Local: fast review iteration
  qa:
    adapter: ollama
    model: qwen:latest              # Local: spec/code QA gate
  execute:
    adapter: claude                 # Cloud: reliable code generation
  docs:
    adapter: claude                 # Cloud: final Markdown docs
```

---

## Supported Backends

### Claude CLI

```bash
npm install -g @anthropic-ai/claude-code
```

Uses `claude --print <prompt>` for non-interactive execution. Ideal for spec generation and code execution due to strong reasoning capabilities.

### Codex CLI

```bash
npm install -g @openai/codex
```

Uses `codex exec <prompt>` for execution. Well-suited for code review and analysis tasks.

### Ollama (Local Models)

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull models you want to use
ollama pull deepseek-coder
ollama pull hermes
ollama pull codellama:13b
```

Uses `ollama run <model> <prompt>`. Each stage can use a different model. MAP auto-detects installed models on launch.

### Binary Detection

On startup, MAP checks for installed binaries using `which` (Unix) or `where` (Windows). The TUI shows installation status for each tool and provides helpful error messages with install commands if a configured adapter isn't found.

---

## Pipeline Stages in Detail

### Stage 1: Spec Generation

The spec agent receives your prompt and generates a structured markdown specification with:
- **Goal** — Clear description of what to build
- **Constraints** — Technical requirements and limitations
- **Non-Goals** — Explicitly excluded scope
- **Acceptance Criteria** — Testable checkboxes (these drive Stage 3)
- **Technical Approach** — Recommended implementation strategy

When feedback is provided (iterations 2+), the agent receives the original prompt plus your feedback and rewrites the spec from scratch.

### Stage 2: Review

A different agent reviews the generated spec and:
- Evaluates **completeness**, **testability**, and **specificity**
- Produces annotations (improvements, warnings, approvals)
- Rewrites the spec with improvements incorporated
- Outputs a **Refinement Score** (0-100) based on:
  - `completeness` (0.0-1.0): Are all requirements captured?
  - `testability` (0.0-1.0): Can each criterion be verified?
  - `specificity` (0.0-1.0): Are requirements concrete enough?

### Feedback Loop

You see the reviewed spec and its Refinement Score. You can:
- **Approve** (`Ctrl+E`) — Proceed to execution. Do this when the score is high and you're confident.
- **Provide feedback** (type + Enter) — Your feedback goes back into Stage 1 with the original prompt. The spec is regenerated incorporating your feedback, then re-reviewed. The cycle repeats.
- **Cancel** (`Ctrl+C`) — Save a git checkpoint and exit. Resume later.

### Stage 3: TDD Execution

The execution agent receives the final reviewed spec and follows strict TDD:

1. **RED**: Write failing tests from the acceptance criteria. Each checkbox in the spec becomes at least one test.
2. **GREEN**: Write the minimum code to make all tests pass.
3. **REFACTOR**: Clean up the code while keeping tests green.

The output is a complete, runnable project in the configured output directory.

After execution, the QA agent evaluates the generated project against the reviewed spec, test results, maintainability, README accuracy, and source organization. Failed code QA sends findings back to the execute agent for a fix pass until `quality.maxCodeQaIterations` is reached.

### Stage 4: Documentation

The docs agent runs after code QA passes. It inspects the generated project, reviewed spec, execution summary, and QA assessments, then creates or updates Markdown documentation in the output directory.

The docs phase is constrained to `.md` files. MAP captures the output directory before the phase and fails the pipeline if the docs agent creates, edits, or removes any non-Markdown file.

---

## Refinement Score

The Refinement Score is the core UX concept that makes MAP work. It answers: **"Is this spec good enough for one-shot execution?"**

```
REFINEMENT SCORE

  Iteration 1:  ========..........  45%
  Iteration 2:  =============.....  72%
  Iteration 3:  =================.  92%  <- now

  Target: ==================..  90% (one-shot)
```

Each iteration through the feedback loop should increase the score. When improvement plateaus (diminishing returns), that's your signal to approve and execute.

The score is computed by the review agent from three dimensions:
- **Completeness**: Are all requirements captured?
- **Testability**: Can acceptance criteria be turned into automated tests?
- **Specificity**: Are requirements concrete enough to implement without guessing?

---

## Checkpoints & Resume

MAP uses git as its checkpoint mechanism. At each stage boundary, all generated files are auto-committed with a structured message:

```
[MAP] stage:reviewing iter:2 id:abc-123 name:task-api ts:2026-04-12T14:32:00Z
```

### Resuming a Pipeline

```bash
map --resume
```

Or press **Ctrl+O** on the Welcome screen to see saved pipelines:

```
  Saved pipelines (git checkpoints):

  > task-api          Iteration 2 | Review done | Paused at: Feedback
    12 Apr 14:32      Agents: claude/codex/claude

    chat-widget       Iteration 1 | Spec done   | Paused at: Review
    11 Apr 09:15      Agents: ollama:hermes/codex/claude

  Resume with current agents?  Or reconfigure:
    Spec:    [claude    ]
    Review:  [codex     ]
    Execute: [claude    ]

  [Enter] Resume  [d] Delete pipeline
```

You can **swap agents** before resuming. This is powerful: start with a fast local model, and if the execution fails, resume with a stronger cloud model.

### Safe Cancel

`Ctrl+C` is always safe. MAP saves a checkpoint before exiting, so you never lose progress.

---

## Examples

### Example 1: Simple CLI Tool

```bash
map "Build a Node.js CLI that converts CSV files to JSON"
```

**Iteration 1**: MAP generates a spec with acceptance criteria like:
- `[ ] Reads CSV from stdin or file argument`
- `[ ] Outputs JSON to stdout`
- `[ ] Handles quoted fields with commas`

**Review** catches missing edge cases: "What about malformed CSV? Empty files?"

**You add feedback**: "Handle errors gracefully with exit code 1"

**Iteration 2**: Improved spec includes error handling criteria.

**Approve & Execute**: Tests written first, then implementation. Output in `./output/`.

### Example 2: REST API with Feedback Loop

```bash
map
```

Type: `Build a REST API for task management with CRUD, authentication, and pagination`

**Iteration 1** (Score: 45%):
- Spec is vague on pagination style and auth method
- Review flags: "Missing rate limiting, no error response schema"

**You add**: `Use cursor-based pagination, JWT auth, rate limit 100 req/min`

**Iteration 2** (Score: 72%):
- Spec is more specific but missing input validation
- Review suggests: "Add request body validation schemas"

**You add**: `Use zod for input validation on all POST/PUT endpoints`

**Iteration 3** (Score: 92%):
- All criteria are specific and testable
- Review: "APPROVAL: Spec is comprehensive and implementation-ready"

**Approve**: Execution produces a complete Express API with 12 passing tests and updated Markdown documentation.

### Example 3: Mixed Ollama Models

Create `pipeline.yaml`:

```yaml
agents:
  spec:
    adapter: ollama
    model: qwen2.5-coder:7b       # Fast local model for spec drafting
  review:
    adapter: ollama
    model: deepseek-coder:latest   # Strong at code analysis
  qa:
    adapter: ollama
    model: qwen:latest             # Local QA loop
  execute:
    adapter: claude                 # Cloud model for reliable execution
  docs:
    adapter: ollama
    model: llama3:latest            # Local final Markdown docs
```

```bash
map "Build a markdown-to-HTML converter library with plugin support"
```

This uses local models for the cheap spec/review/QA/docs work and a cloud model for the expensive implementation and QA-driven fixes.

---

## CLI Reference

```
MAP - Multi-Agent Pipeline
One prompt. One shot. Working software.

Usage:
  map                    Launch interactive TUI
  map "your idea"        Start pipeline with a prompt
  map --resume [id]      Resume a saved pipeline
  map --config <path>    Use custom config file
  map --headless "idea"  Run non-interactively, outputs JSON to stdout
  map --github-issue <url>
                         Use a GitHub issue as prompt and post final report

Options:
  --help, -h             Show help
  --version, -v          Show version
  --config <path>        Path to pipeline.yaml config
  --resume [id]          Resume a saved pipeline
  --headless             Run without TUI, print JSON result to stdout
  --output-dir <path>    Output directory (headless mode)
  --total-timeout <dur>  Total headless runtime budget, e.g. 60m
  --inactivity-timeout <dur>
                         Stall timeout since last stage activity, e.g. 10m
  --poll-interval <dur>  Internal polling cadence for timeout checks, e.g. 10s
  --github-issue <url>   GitHub issue URL for prompt/reporting (requires GITHUB_TOKEN)
```

### Keyboard Shortcuts

| Screen | Key | Action |
|--------|-----|--------|
| Welcome | `Tab` | Select stage for agent assignment |
| Welcome | `Enter` | Start pipeline / Change agent |
| Welcome | `Ctrl+O` | Open saved pipelines |
| Pipeline | `Ctrl+C` | Cancel & save checkpoint |
| Feedback | `Enter` | Submit feedback, refine spec |
| Feedback | `Ctrl+E` | Approve & execute |
| Feedback | `Tab` | Toggle spec/diff view |
| Execute | `Ctrl+C` | Cancel & save checkpoint |
| Complete | `Enter` | Start new pipeline |
| Complete | `o` | Open output directory |

---

## Architecture

### File Structure

```
src/
  cli.ts                        # CLI entry point
  index.ts                      # Library exports
  types/                        # TypeScript interfaces
    adapter.ts                  # AgentAdapter, AdapterConfig, DetectionResult
    pipeline.ts                 # PipelineStage, PipelineContext, PipelineEvent
    spec.ts                     # Spec, ReviewedSpec, RefinementScore, DocumentationResult
    config.ts                   # PipelineConfig, AgentAssignment
    checkpoint.ts               # CheckpointData, CheckpointMeta
  adapters/                     # AI backend wrappers
    base-adapter.ts             # Abstract base with subprocess management
    claude-adapter.ts           # claude --print <prompt>
    codex-adapter.ts            # codex exec <prompt>
    ollama-adapter.ts           # ollama run <model> <prompt>
    adapter-factory.ts          # Config -> AgentAdapter
    detect.ts                   # Binary detection + Ollama model listing
  pipeline/                     # Core orchestration
    machine.ts                  # XState 5 state machine (12 states)
    guards.ts                   # Transition guard functions
    context.ts                  # Pipeline context factory
  config/                       # Configuration
    loader.ts                   # YAML config loading + merge
    defaults.ts                 # Default agent assignments
    schema.ts                   # Config validation
  checkpoint/                   # Git-based persistence
    git-checkpoint.ts           # Git operations (init, commit, log)
    checkpoint-manager.ts       # Save/restore pipeline state
    parser.ts                   # Checkpoint commit message format
  tui/                          # Terminal UI (Ink 7 + React 19)
    App.tsx                     # Screen router (XState state -> screen)
    screens/                    # 6 full-page screens
    components/                 # 11 reusable components
    hooks/                      # useAgent, useScrollable, useKeyboard
    providers/                  # PipelineProvider, ConfigProvider
  prompts/                      # System prompt templates
    spec-system.ts              # Spec generation prompt
    review-system.ts            # Spec review prompt
    execute-system.ts           # TDD execution prompt
    feedback-system.ts          # Feedback refinement prompt
    docs-system.ts              # Final Markdown documentation prompt
  utils/                        # Shared utilities
    error.ts                    # Custom error types
    platform.ts                 # Cross-platform helpers
    logger.ts                   # Debug logging
```

### State Machine

```
idle --[START]--> specifying --[SPEC_COMPLETE]--> reviewing --[REVIEW_COMPLETE]--> specAssessing
                       ^                                                                 |
                       +----[SPEC_QA_FAIL/FEEDBACK]--------------------------------------+
                                                                                         |
feedback <--[SPEC_QA_PASS]---------------------------------------------------------------+
    |
    +--[APPROVE]--> executing --[EXECUTE_COMPLETE]--> codeAssessing --[CODE_QA_PASS]--> documenting --[DOCS_COMPLETE]--> complete
                                                      |
                                                      +--[CODE_QA_FAIL]--> fixing --[CODE_FIX_COMPLETE]--> codeAssessing

[ERROR] -> failed (recoverable via FEEDBACK from failed)
[CANCEL] -> cancelled (from active/user-waiting states)
```

### Adapter Interface

All adapters implement the same interface:

```typescript
interface AgentAdapter {
  readonly type: 'claude' | 'codex' | 'ollama';
  readonly model: string | undefined;
  detect(): Promise<DetectInfo>;
  run(prompt: string, options?: RunOptions): AsyncGenerator<string>;
  cancel(): void;
}
```

The `run()` method returns an `AsyncGenerator` that yields output chunks as strings. This enables real-time streaming in the TUI. Cancellation is handled via `AbortSignal`.

---

## Development

```bash
# Clone and install
git clone <repo-url>
cd multi-agent-pipeline
npm install

# Run tests (212 tests)
npm test

# Watch mode
npm run test:watch

# Type check
npm run typecheck

# Development mode (runs without building)
npm run dev

# Build for distribution
npm run build
```

### Testing

MAP uses [vitest](https://vitest.dev/) with 212 tests across 39 test files:

- **Type contract tests** — Verify interface shapes and helper functions
- **Adapter tests** — Binary detection, streaming, cancellation (with MockAdapter)
- **Pipeline tests** — State machine transitions, feedback loop, error recovery
- **Config tests** — YAML loading, validation, merge with defaults
- **Checkpoint tests** — Git operations with real temp directories
- **Component tests** — All TUI components via `ink-testing-library`
- **Screen tests** — Each screen renders correctly with various props
- **E2E tests** — Full pipeline flow with MockAdapter, CLI argument parsing

---

## Roadmap

### v2 Planned Features

- **Token usage tracking** — Measure and report tokens per stage for efficiency analysis
- **Auto-retry with escalation** — Automatically retry failed stages, optionally escalating to a stronger model
- **Mid-stage resume** — Resume from within a stage, not just at boundaries
- **Plugin system** — Custom adapters for additional AI tools
- **Parallel execution** — Run multiple acceptance criteria tests in parallel
- **Web UI** — Browser-based alternative to the terminal TUI

---

## License

MIT
