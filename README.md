# MAP - Multi-Agent Pipeline

**One task. One shot. Useful output.**

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

Install the `map` command:

```bash
curl -fsSL https://raw.githubusercontent.com/berlinguyinca/multi-agent-pipeline/main/install.sh | bash
```

Run the interactive TUI:

```bash
map
```

Run headless classic mode:

```bash
map --headless "Investigate how a concept is used in a domain"
```

Run headless smart-routing mode:

```bash
map --headless --v2 "Research the best design, implement it with tests, then review readiness"
```

For local development without linking the command globally:

```bash
npm install
npm run dev -- --help
```

## Install And Build

Fastest install from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/berlinguyinca/multi-agent-pipeline/main/install.sh | bash
```

The installer clones or updates MAP in `~/.local/share/multi-agent-pipeline`, installs dependencies, builds `dist/cli.js`, links `map` onto your `PATH`, and creates `~/.map/pipeline.yaml` when needed.

Onboarding detects available backends, sets classic and v2 defaults, enables the software-delivery agent bundle, and can optionally generate a custom agent. Non-interactive `curl | bash` installs use safe defaults.

Installer options:

```bash
# Install somewhere else
curl -fsSL https://raw.githubusercontent.com/berlinguyinca/multi-agent-pipeline/main/install.sh \
  | MAP_INSTALL_DIR="$HOME/dev/multi-agent-pipeline" bash

# Install from another branch or fork
curl -fsSL https://raw.githubusercontent.com/berlinguyinca/multi-agent-pipeline/main/install.sh \
  | MAP_BRANCH=main MAP_REPO_URL=https://github.com/berlinguyinca/multi-agent-pipeline.git bash

# Build but skip npm link
curl -fsSL https://raw.githubusercontent.com/berlinguyinca/multi-agent-pipeline/main/install.sh \
  | MAP_NO_LINK=1 bash

# Install/build without pulling updates first
curl -fsSL https://raw.githubusercontent.com/berlinguyinca/multi-agent-pipeline/main/install.sh \
  | MAP_NO_UPDATE=1 bash

# Skip config onboarding
curl -fsSL https://raw.githubusercontent.com/berlinguyinca/multi-agent-pipeline/main/install.sh \
  | MAP_SKIP_ONBOARDING=1 bash
```

Onboarding environment variables:

- `MAP_CONFIG_PATH`: config file to create, default `~/.map/pipeline.yaml`.
- `MAP_FORCE_CONFIG=1`: overwrite an existing generated config.
- `MAP_ASSUME_DEFAULTS=1`: do not prompt; use detected/default settings.
- `MAP_SKIP_ONBOARDING=1`: install/build/link only.
- `MAP_OLLAMA_MODEL`: local model default, default `gemma4:26b`.
- `MAP_OLLAMA_HOST`: Ollama host, default `http://localhost:11434`.
- `MAP_OUTPUT_DIR`: generated project output directory, default `./output`.
- `MAP_DEFAULT_MODEL`: optional model for non-Ollama adapters.
- `MAP_DEFAULT_AGENT_ADAPTER`: default adapter for software-delivery agents.
- `MAP_NO_UPDATE=1`: skip the git self-update step.
- `MAP_FORCE_UPDATE=1`: allow git update attempts even when the checkout has local changes.

From this checkout, run the same installer directly:

```bash
./install.sh
```

Rerun only configuration onboarding later:

```bash
scripts/configure-map.sh
```

Force-regenerate config with defaults without prompting:

```bash
MAP_FORCE_CONFIG=1 MAP_ASSUME_DEFAULTS=1 scripts/configure-map.sh
```

Generate a config that backs all software-delivery agents with Codex:

```bash
MAP_FORCE_CONFIG=1 \
MAP_ASSUME_DEFAULTS=1 \
MAP_DEFAULT_AGENT_ADAPTER=codex \
scripts/configure-map.sh
```

From a local checkout:

```bash
npm install
npm run build
./dist/cli.js --help
./dist/cli.js --headless "Explain how alanine is used in metabolomics research"
npm link
map --help
map --headless --v2 "Research the best approach, plan the steps, and review readiness"
```

If you use `npm link`, rebuild after source changes before running `map` again:

```bash
npm run build
map agent list
```

Remove the linked global command:

```bash
npm unlink -g multi-agent-pipeline
```

Helper scripts wrap the same workflows:

```bash
scripts/build-map.sh
scripts/link-map.sh
scripts/unlink-map.sh
scripts/configure-map.sh
```

After building, run the local CLI without npm:

```bash
scripts/map-classic.sh "Explain how alanine is used in metabolomics research"
scripts/map-v2.sh "Research the best approach, plan the steps, and review readiness"
scripts/map-agent.sh list
scripts/map-agent.sh test implementation-coder
scripts/map-agent.sh create --adapter ollama --model gemma4:26b
```

The run scripts accept environment variables for common flags:

```bash
PERSONALITY="Be concise and strict about verification." \
CONFIG=./pipeline.yaml \
OUTPUT_DIR=./output/demo \
scripts/map-classic.sh "Explain a concept in the target domain"
```

```bash
PERSONALITY="Prefer small diffs and explicit risks." \
CONFIG=./pipeline.yaml \
scripts/map-v2.sh "Investigate the task, plan execution, and review readiness"
```

Common script variables:

- Classic: `CONFIG`, `OUTPUT_DIR`, `TOTAL_TIMEOUT`, `INACTIVITY_TIMEOUT`, `POLL_INTERVAL`, `GITHUB_ISSUE`, `PERSONALITY`
- V2: `CONFIG`, `OUTPUT_DIR`, `PERSONALITY`

## Two Modes of Operation

MAP has two primary usage modes. Choose the one that fits your workflow:

| | Interactive TUI | Headless Service |
| --- | --- | --- |
| **Purpose** | Developer at the terminal, steering the pipeline in real-time | Unattended execution for CI, cron jobs, or long-running daemons |
| **Launch** | `map` | `map --headless "prompt"` |
| **Feedback** | You review specs, give feedback, approve or reject | Auto-approves every stage |
| **Output** | Rich terminal UI with streaming, scores, diffs | Structured JSON to stdout, progress to stderr |
| **Best for** | Exploratory work, research questions, agent assignment | Batch builds, scheduled issue processing, PR review bots |

Use `map ...` after installing the package globally. In a local checkout, use `npm run dev -- ...` with the same arguments.

---

## Interactive TUI

The TUI is a neo-blessed terminal interface for hands-on pipeline work. You see every stage as it happens, review specs with refinement scores, give feedback, swap agents per stage, and approve execution when the spec is ready.

### Launching

```bash
# Open the TUI with an empty welcome screen
map

# Pre-fill the prompt so the welcome screen is ready to go
map "Explain how alanine is used in metabolomics research"

# Point at a specific config
map --config ./pipeline.yaml "Explain the tradeoffs of two approaches"

# Start from a GitHub issue — the issue title, body, and comments become the prompt
map --github-issue https://github.com/owner/repo/issues/123

# Resume a previously checkpointed pipeline
map --resume
```

### Screens

The TUI walks through a series of screens that mirror the pipeline stages:

**Welcome** — Choose which AI backend handles each classic stage (spec, review, QA, execute, docs). Enter a task, question, or GitHub issue URL. Press Enter to continue.

**Pipeline** — Shows a stage progress bar and streams live output from the current agent. The status line at the bottom tracks elapsed time and the active stage.

**Feedback** — Appears after spec review. Displays the reviewed spec, a refinement score (completeness, testability, specificity → combined 0-100), and an optional diff against the previous iteration. Type feedback to refine further, or approve to move to execution.

**DAG Execution** (v2) — When running smart-routing inside the TUI, shows each DAG step with status icons (pending, running, completed, failed, skipped), the assigned agent, and per-step duration.

**Router Plan** (v2) — Displays the router-generated DAG before execution. Review the step graph — agent assignments, tasks, and dependency chains — then press Enter to execute or Esc to cancel.

**Complete** — Summarizes the finished pipeline: test counts (passing/failing), files created, docs updated, iteration count, total duration, and GitHub report status if applicable.

### Keyboard Shortcuts

| Screen | Key | Action |
| --- | --- | --- |
| Welcome | `Tab` | Cycle focus: agent picker, URL input, prompt |
| Welcome | `Enter` | Start pipeline or confirm agent change |
| Welcome | `Ctrl+O` | Browse saved checkpoints |
| Pipeline | `Ctrl+C` | Cancel pipeline and save checkpoint |
| Feedback | `Enter` | Submit feedback text and refine spec |
| Feedback | `Ctrl+E` | Approve spec and begin execution |
| Feedback | `Tab` | Toggle between full spec and diff view |
| Complete | `Enter` | Start a new pipeline |
| Complete | `o` | Open output directory in file manager |
| Any | `q` | Quit |
| Any | `Esc` | Go back |

### TUI Workflow

A typical interactive session looks like this:

1. Launch `map` and land on the Welcome screen.
2. Optionally reassign agents per stage (e.g. switch spec from Claude to Ollama).
3. Type or paste a prompt, then press Enter.
4. Watch the spec stage stream output. Review arrives next with a refinement score.
5. On the Feedback screen, read the score. If it is low, type feedback and press Enter to loop back through spec/review. If the score is high or plateaued, press `Ctrl+E` to approve.
6. Execution runs TDD: watch test markers (`[TEST:PASS]`, `[TEST:FAIL]`) stream in real-time.
7. Code QA may loop back to fix issues automatically (up to `maxCodeQaIterations`).
8. Docs stage generates or updates Markdown files.
9. Complete screen shows the summary. Press `o` to open the output directory.

If you `Ctrl+C` at any point, MAP saves a git checkpoint. Resume later with `map --resume`.

---

## Headless Service

Headless mode runs the full pipeline without user interaction: every approval is automatic, output is structured JSON on stdout, and progress (when `--verbose` is set) goes to stderr. This makes it suitable for three deployment patterns: one-shot CLI invocations, cron-scheduled jobs, and long-running daemons.

### One-Shot Invocation

Run once and exit. Good for CI pipelines, local scripts, or manual batch runs.

```bash
# Classic pipeline — fixed spec/review/QA/execute/docs stages
map --headless "Explain how a concept is used in a domain"

# Smart-routing v2 — router picks agents and builds a DAG
map --headless --v2 "Research the best approach, plan the work, and review readiness"

# Write output to a specific directory
map --headless --output-dir ./output/pantry "Investigate a specific question"

# Inject a personality or tone into all AI prompts
map --headless \
  --personality "Be concise, skeptical, and strict about test evidence." \
  "Explain a technical tradeoff"

# Use a GitHub issue as the prompt and post the result back as a comment
map --headless --github-issue https://github.com/owner/repo/issues/123

# Review a pull request and post findings as a PR comment
map --review-pr https://github.com/owner/repo/pull/456
```

### Cron-Scheduled Runs

Use cron (or systemd timers, launchd, GitHub Actions schedules) to run MAP on a recurring basis against a single repo. Common use cases: nightly builds from a backlog issue, periodic PR review sweeps, or scheduled spec generation.

```bash
# crontab -e
# Run every night at 2 AM against the next open issue labeled "map-ready"
0 2 * * * cd /path/to/repo && map --headless \
  --config /path/to/pipeline.yaml \
  --github-issue "$(gh issue list -l map-ready --limit 1 --json url -q '.[0].url')" \
  --output-dir ./output/nightly \
  --total-timeout 60m \
  --verbose \
  >> /var/log/map-nightly.log 2>&1
```

```bash
# Review all open PRs every 6 hours
0 */6 * * * cd /path/to/repo && gh pr list --json url -q '.[].url' | while read -r pr; do \
  map --review-pr "$pr" --config /path/to/pipeline.yaml >> /var/log/map-pr-review.log 2>&1; \
done
```

A wrapper script for issue-driven cron:

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO_DIR="/path/to/repo"
CONFIG="$HOME/.map/pipeline.yaml"

cd "$REPO_DIR"
ISSUE_URL="$(gh issue list -l map-ready --limit 1 --json url -q '.[0].url')"
[ -z "$ISSUE_URL" ] && exit 0

map --headless \
  --config "$CONFIG" \
  --github-issue "$ISSUE_URL" \
  --output-dir "./output/$(date +%Y%m%d-%H%M%S)" \
  --total-timeout 60m \
  --inactivity-timeout 10m \
  --verbose
```

### Long-Running Daemon

For continuous operation — watching a repo for new issues or running on a polling loop — wrap MAP in a simple daemon script or a systemd service. MAP itself is not a daemon; each invocation runs one pipeline and exits. The daemon wrapper handles scheduling and restarts.

Polling loop example:

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO_DIR="/path/to/repo"
CONFIG="$HOME/.map/pipeline.yaml"
POLL_INTERVAL=300  # seconds between checks

cd "$REPO_DIR"
while true; do
  ISSUE_URL="$(gh issue list -l map-ready --limit 1 --json url -q '.[0].url' 2>/dev/null || true)"
  if [ -n "$ISSUE_URL" ]; then
    echo "[$(date)] Processing $ISSUE_URL"
    map --headless \
      --config "$CONFIG" \
      --github-issue "$ISSUE_URL" \
      --output-dir "./output/$(date +%Y%m%d-%H%M%S)" \
      --total-timeout 60m \
      --inactivity-timeout 10m \
      --verbose 2>&1 | tee -a /var/log/map-daemon.log
    # Optionally close/label the issue after success
    gh issue edit "$ISSUE_URL" --remove-label map-ready --add-label map-done
  fi
  sleep "$POLL_INTERVAL"
done
```

systemd unit example (`/etc/systemd/system/map-daemon.service`):

```ini
[Unit]
Description=MAP Pipeline Daemon
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/path/to/repo
ExecStart=/path/to/map-daemon.sh
Restart=on-failure
RestartSec=30
Environment=PATH=/usr/local/bin:/usr/bin
Environment=MAP_CONFIG_PATH=/home/deploy/.map/pipeline.yaml

[Install]
WantedBy=multi-user.target
```

### Timeouts

Headless mode enforces three timeout budgets to prevent runaway runs:

| Flag | Config key | Default | Purpose |
| --- | --- | --- | --- |
| `--total-timeout` | `headless.totalTimeoutMs` | 60m | Maximum wall-clock time for the entire pipeline |
| `--inactivity-timeout` | `headless.inactivityTimeoutMs` | 10m | Maximum silence from the AI backend before aborting |
| `--poll-interval` | `headless.pollIntervalMs` | 10s | How often MAP checks the timeout clocks |

Durations accept human-readable strings: `30s`, `10m`, `2h`. The relationship must be `totalTimeout > inactivityTimeout > pollInterval`.

### Verbose Progress

Pass `--verbose` (or `-V`) to emit human-readable progress on stderr while JSON goes to stdout. Useful for cron logs and daemon monitoring:

```bash
map --headless --verbose "Explain a technical concept" > result.json 2> progress.log
```

Verbose output includes: stage transitions, byte counts, elapsed time, QA verdicts, and test markers.

### Output Format

Classic mode (v1) returns:

```json
{
  "version": 1,
  "success": true,
  "spec": "...",
  "filesCreated": ["src/index.ts", "tests/index.test.ts"],
  "outputDir": "./output",
  "testsTotal": 12,
  "testsPassing": 12,
  "testsFailing": 0,
  "duration": 45200,
  "qaAssessments": [],
  "githubReport": { "posted": true, "url": "..." }
}
```

Smart-routing mode (v2) returns:

```json
{
  "version": 2,
  "success": true,
  "dag": { "nodes": [], "edges": [] },
  "steps": [
    { "id": "step-1", "agent": "spec-writer", "status": "completed", "duration": 8200 }
  ],
  "duration": 32100
}
```

---

## Agent Commands

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

## Local Development Equivalents

From this repository, prefix the same commands with `npm run dev --`:

```bash
npm run dev -- --headless --v2 \
  --personality "Use a terse engineering review style." \
  "Research the task, plan execution, and review readiness"
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
map --headless --v2 "Research the task, plan the steps, and assess readiness"
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

MAP ships with a software-delivery bundle. These agents default to `adapter: ollama` and `model: gemma4:26b`:

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
  tui/            neo-blessed terminal UI
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

Verification baseline:

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
