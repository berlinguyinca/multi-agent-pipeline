# MAP - Multi-Agent Pipeline

**One task. One shot. Useful output.**

MAP orchestrates AI CLIs and local models through spec-first, test-driven software delivery. It uses v2 smart routing by default to select repo-defined agents and execute a dependency-aware DAG, with the original guided pipeline still available through `--classic`.

```bash
npm install -g multi-agent-pipeline
map
```

## What MAP Does

MAP supports two execution modes:

- **Smart routing v2**: the default. A router reads registered agents from `agents/`, creates a DAG plan, runs reviewed specs through the `adviser` workflow gate for coding tasks, and executes independent agent steps in parallel where possible.
- **Classic pipeline**: optional fixed-stage mode for spec generation, spec review, spec QA, user feedback, TDD execution, code QA, and Markdown docs.

The core idea is the same in both modes: invest in the spec and verification path before spending expensive implementation cycles.

For software builds, smart routing and adviser guidance now treat licensing and post-build documentation as part of delivery: after implementation and QA, `legal-license-advisor` should recommend compatible license options from the utilized languages, libraries, package manifests, and existing license evidence, then `docs-maintainer` should update or create a README that explains what the tool does and how to use it and should document license coverage. If no repository license exists and the requested license is unspecified, the docs agent reports an explicit license-choice blocker instead of inventing legal terms.

Code QA can also drive an autonomous repair loop. `code-qa-analyst` ends implementation reviews with a structured `accept|revise|reject` verdict; when it returns `revise` or `reject`, MAP rewires downstream steps through the upstream file-producing developer agent, reruns QA after the repair, and repeats up to `quality.maxCodeQaIterations`.

Software-development workflows are expected to run verification tests in isolated environments. When a feature needs databases or service dependencies, agents should use Docker-backed project test services (`docker compose`, Testcontainers, devcontainers, or equivalent project scripts), disposable volumes, random/free ports, and test-only credentials. Agents must not point tests at host databases, shared developer services, production endpoints, or main-system state; if Docker or the project test service setup is unavailable, they should report that blocker instead of silently testing against the host.

For greenfield software prompts, headless v2 now defaults the execution workspace to `<outputDir>/workspace` unless `--workspace-dir` or `workspaceDir` is set explicitly. This keeps generated source/test files separate from MAP reports, PDFs, graphs, and prior output artifacts.

Smart-routing software recovery is also more execution-biased now: when the router cannot build a valid plan for a software task, MAP synthesizes a concrete software lifecycle fallback with deterministic `spec-writer -> spec-qa-reviewer -> spec-writer revision` handoff before coding. It then prefers the unified `coder` agent when that agent is registered; otherwise it falls back to the `tdd-engineer` + `implementation-coder` path.

To reduce no-progress loops, file-output agents no longer get to silently succeed by repeating the same successful inspection tool call. MAP injects explicit remediation context, requires a materially different tool call or final verified answer, and fails the handoff if the agent still only returns a duplicate-tool placeholder.
If a file-output agent reaches the tool-call cap after actually changing workspace files, MAP preserves those file artifacts and lets downstream implementation or QA evaluate/repair them instead of discarding the work as a total failure.
TDD agents use a smaller tool-call cap than implementation agents so partial test artifacts are handed off quickly instead of spending many minutes in repeated inspection loops.
TDD and broad software-delivery lanes also have hard wall-clock guards so continuous streaming without convergence cannot reset the no-progress timer forever.
When adviser decomposes a no-output broad implementation after TDD artifacts already exist, MAP normalizes the workflow toward implementation lanes instead of adding another round of TDD-first loops.
Broad `software-delivery` steps also use a shorter no-progress timeout than focused implementation lanes so the workflow decomposes faster when broad delivery stalls without file changes.
Security scanning treats MD5/SHA1 checksum/integrity fixtures differently from password or cryptographic use so data-ingestion tests for upstream checksum formats do not block the workflow as weak-crypto findings.
Low-severity LLM-only security findings are reported as warnings instead of blocking remediation, reserving hard security stops for medium-or-higher LLM findings or static critical/high patterns.

When executing a saved refined prompt, MAP treats the refine answers as complete input. Router cleanup removes accidental `prompt-refiner` steps from already-refined plans, and agent conduct instructs downstream agents to use the provided answers plus reasonable assumptions instead of asking the same blocking questions again.
For already-refined software plans, router cleanup also removes initial TDD-only gates when an implementation lane is already present, allowing implementation/QA repair to proceed instead of re-entering long test-authoring loops.

## Quick Start

Install the `map` command:

```bash
curl -fsSL https://raw.githubusercontent.com/berlinguyinca/multi-agent-pipeline/main/install.sh | bash
```

Run the interactive TUI:

```bash
map
```

Run headless smart-routing mode:

```bash
map --headless "Investigate how a concept is used in a domain"
```

Run headless smart-routing mode from an existing spec file:

```bash
map --headless --spec-file docs/spec.md
```

Refine a rough prompt before running:

```bash
map refine "Build something useful for this repository"
map refine --output .map/refined-prompts/task.md "Build something useful"
map refine --run "Build something useful"
map --headless --refine "Build something useful"
```

Run the optional classic fixed-stage pipeline:

```bash
map --headless --classic "Research the best design, implement it with tests, then review readiness"
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

When `map` runs from a git checkout, it checks the checkout's tracked branch for newer commits before loading the command runner and fast-forwards when a newer revision is available.

Runtime self-update controls:

- `MAP_NO_UPDATE=1`: disable the launch-time update check.
- `MAP_FORCE_UPDATE=1`: allow an update attempt even if the checkout has local changes.
- `MAP_BRANCH=<branch>`: force the tracked branch used for update checks.
- `CI=1` or `CI=true`: skip the update check in CI environments.

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
- `MAP_BRANCH`: tracked branch name for runtime self-update, defaulting to the current checkout branch.

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
map --headless "Research the best approach, plan the steps, and review readiness"
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

# Start from a local spec file instead of a freeform prompt
map --spec-file docs/spec.md

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

Headless mode runs the full pipeline without user interaction: every approval is automatic, output is written to stdout in a readable format, and the final output directory is reported on stderr unless `--silent` is set. Progress (when `--verbose` is set) also goes to stderr. JSON is the default stdout format; use `--output-format markdown`, `yaml`, `html`, `text`, or `pdf` when those are easier for people or downstream tools to read. HTML/PDF output renders Markdown as polished report HTML, escapes raw HTML emitted by agents, and embeds validated deterministic visual artifacts such as the agent flowchart, usage commonness ranking plot, and taxonomy tree diagram when source data is available. Reports also include an **Agent Contributions** section that explains how each agent improved the result, what evidence it produced for downstream steps, and how to manually rerun the same prompt while disabling a specific agent for comparison. Use `--dag-layout auto|stage|metro|matrix|cluster|circular` to choose the agent-network visualization style for HTML/PDF reports and generated SVG artifacts. Use `--graph` to additionally write easy-to-understand agent-network images for every supported graph layout (`auto`, `stage`, `metro`, `matrix`, `cluster`, and `circular`) as PNG files when Chrome/Chromium is available, with SVG fallbacks otherwise. PDF output writes a polished print-ready HTML file without raw JSON result dumps, defaults the inline DAG section to a terse pipeline summary to avoid oversized flowcharts, and when Chrome/Chromium is available, also writes a PDF artifact. This makes it suitable for three deployment patterns: one-shot CLI invocations, cron-scheduled jobs, and long-running daemons.

### One-Shot Invocation

Run once and exit. Good for CI pipelines, local scripts, or manual batch runs.

```bash
# Smart-routing v2 — default router-picked DAG
map --headless "Explain how a concept is used in a domain"

# Smart-routing v2 from a prewritten spec file
map --headless --spec-file docs/spec.md

# Classic pipeline — fixed spec/review/QA/execute/docs stages
map --headless --classic "Research the best approach, plan the work, and review readiness"

# Write reports/artifacts to a specific directory
map --headless --output-dir ./output/pantry "Investigate a specific question"

# Execute agents against an existing project while keeping reports elsewhere
map --headless \
  --workspace-dir ../existing-platform \
  --output-dir ../existing-platform/.map/reports/billing \
  "Add subscription billing to the existing platform using its current code and tests"

# Print the final MAP result as readable Markdown or YAML
map --headless --output-format markdown "Investigate a specific question"
map --headless --output-format yaml "Investigate a specific question"
map --headless --output-format html "Investigate a specific question"
map --headless --output-format text "Investigate a specific question"
map --headless --output-format pdf "Investigate a specific question"
map --headless --output-format html --dag-layout metro "Investigate a branching workflow"
map --headless --output-format pdf --dag-layout cluster "Summarize a large workflow"

# Open generated HTML/PDF output automatically when finished
map --headless --output-format html --open-output "Investigate a specific question"
map --headless --output-format pdf --open-output "Investigate a specific question"
map --headless --open-output "Investigate a specific question" # prints JSON and opens a companion HTML report
map --headless --silent "Investigate a specific question" # stdout is only the requested format; no progress/path chatter

# Print only the utilized agent graph and the final output
map --headless --compact "Investigate a specific question"

# Write PNG agent-network graphs for every supported DAG layout
map --headless --graph "Investigate a specific question"

# Rerun while removing one or more smart-routing agents from consideration
map --headless --disable-agent output-formatter,researcher "Investigate a specific question"

# Automatically compare the full network against reruns with selected agents disabled
map --headless --compare-agents researcher,output-formatter --semantic-judge "Investigate a specific question"

# Ask an LLM judge panel to vote on the DAG outcome and rejudge after improvements
map --headless \
  --judge-panel-models ollama/gemma4:26b,claude/sonnet,codex/gpt-5 \
  --judge-panel-steer \
  --judge-panel-max-rounds 2 \
  "Investigate a specific question"

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
| `--router-timeout` | `router.timeoutMs` | 5m | Maximum time allowed for router planning |
| `--router-model` | `router.model` | config value | Override the smart-routing router model for this run |
| `--router-consensus-models` | `router.consensus.models` | repeats `router.model` | Override the default router consensus candidates with up to 3 comma-separated Ollama models |
| `--disable-agent` / `--disable-agents` | `agentOverrides.<name>.enabled=false` | none | Remove one or more comma-separated smart-routing agents from the available-agent list for this run |
| `--compare-agents [csv]` | run option | off | Run ablation comparisons by rerunning with selected agents disabled; omit CSV to compare agents used by the baseline |
| `--compare-agent-list <csv>` | run option | off | Explicit comma-separated comparison candidate list when shell quoting makes optional `--compare-agents` ambiguous |
| `--semantic-judge` | run option | off | Include deterministic output-similarity verdicts for comparison runs |
| `--judge-panel-models <csv>` | run option | off | Run an LLM judge panel after the DAG. Entries can be plain models using the router adapter or provider-qualified specs like `ollama/gemma4:26b,claude/sonnet,codex/gpt-5` |
| `--judge-panel-roles <csv>` | run option | defaults by index | Assign adversarial judge roles such as `evidence-skeptic`, `recency-auditor`, `contradiction-finder`, and `user-value-judge` |
| `--judge-panel-steer` | run option | off | Let a revise/reject judge-panel verdict trigger feedback-driven reruns with panel feedback injected into the task |
| `--judge-panel-max-rounds <n>` | run option | 1 | Maximum judge-panel steering reruns; judges re-vote after each improvement until they accept or this budget is exhausted |
| `--disable-cross-review` | run option | off | Disable high-impact autonomous cross-model review for this run |
| `--cross-review-max-rounds <n>` | `crossReview.maxRounds` | `2` | Maximum judge-steered remediation rounds before best-effort reporting |
| `--cross-review-judge-models <csv>` | `crossReview.judge.models` | config value | Override hybrid cross-review judges; currently only the first two entries are used (`1` = peer review, `2` = judge; one entry = judge; extras ignored/reserved) |
| `--ollama-host` | `ollama.host` | `http://localhost:11434` | Override the Ollama server host for detection, pulls, and requests |
| `--ollama-context-length` | `ollama.contextLength` | `100000` | Set `OLLAMA_CONTEXT_LENGTH` when MAP starts `ollama serve` |
| `--ollama-num-parallel` | `ollama.numParallel` | `2` | Set `OLLAMA_NUM_PARALLEL` for parallel requests per loaded model |
| `--ollama-max-loaded-models` | `ollama.maxLoadedModels` | `2` | Set `OLLAMA_MAX_LOADED_MODELS` for concurrently loaded models |
| `--workspace-dir` / `--target-dir` | `workspaceDir` | `outputDir` (or `<outputDir>/workspace` for greenfield software prompts) | Directory where smart-routing agents execute, inspect existing source/data, and apply code changes |

Durations accept human-readable strings: `30s`, `10m`, `2h`. The relationship must be `totalTimeout > inactivityTimeout > pollInterval`.

Use `--workspace-dir` when MAP should build on an existing project or collected-data directory. The workspace becomes the agent/tool/adaptor working directory, while `--output-dir` remains the location for MAP reports, run Markdown, PDFs, and visual artifacts. If `--workspace-dir` is omitted, smart-routing mode preserves the previous behavior and executes agents in `--output-dir`.
Execution steps also use `router.stepTimeoutMs` and `router.maxStepRetries`. `router.stepTimeoutMs` is a per-step no-progress timeout: MAP aborts a step only when no output chunk arrives within that window. When a step times out, MAP retries it and doubles the next step timeout budget. If the retried step succeeds, MAP records the larger per-agent timeout in `.map/adaptive-timeouts.json` and uses it for later runs in the same checkout. The default retry count is intentionally low to avoid hour-scale local-model stalls.
When `code-qa-analyst` emits a structured `revise` or `reject` verdict for an implementation review, v2 schedules a developer repair step using the upstream file-output agent, reruns code QA, and rewires downstream dependencies to the passing QA retry. The loop budget is `quality.maxCodeQaIterations`.

### Agent contribution reports and self-optimization

Every human-readable result now includes:

- **Agent Contributions** — per-agent step counts, status, task summary, role-specific benefit explanation, consensus confidence notes, and a ready-to-copy rerun command such as `map --headless "prompt" --disable-agent researcher`.
- **Rerun and self-optimization** — the original rerun command plus network self-check recommendations. Failed agents, failed handoffs, or missed spec-conformance checks are surfaced as candidates to question or disable on the next run.
- **Agent Comparison Runs** when `--compare-agents` is used — baseline-vs-disabled-agent success, duration, final-output similarity, and a keep/disable/review recommendation.
- **LLM Judge Panel** when `--judge-panel-models` is used — independent model votes (`accept`, `revise`, or `reject`), confidence, requested improvements, per-round rejudging after improvements, and whether `--judge-panel-steer` applied feedback-driven reruns.

The same data is also exposed in JSON/YAML as `agentContributions`, `agentComparisons`, `routerRationale`, `semanticJudge`, `judgePanel`, and `rerun`, so downstream automation can detect weak agents without scraping prose. MAP also records rolling per-agent counters in `.map/agent-performance.json`. This lets users compare the full network against narrower runs without editing `pipeline.yaml`. The router receives a filtered available-agent list, so disabled agents cannot be selected for the initial DAG or adviser refreshes during that run. When a run starts from `--spec-file` and includes extra prompt text, that prompt tail is preserved in the generated rerun command.

### Socratic prompt refinement

Use `map refine` when the task is vague, high-stakes, or likely to benefit from clarification before running a DAG. Refine mode applies Socratic scoring across goal clarity, constraints, evidence requirements, output specificity, and risk coverage. It returns an optimized prompt plus assumptions and recommended MAP capabilities such as `model-installer`, `codesight-metadata`, `classyfire-taxonomy-classifier`, or `usage-classification-tree`.

```bash
map refine "Analyze this repo and make it better"
map refine --output .map/refined-prompts/repo-analysis.md "Analyze this repo and make it better"
map refine --run "Analyze this repo and make it better"
map --headless --refine "Analyze this repo and make it better"
```

`map refine --run` refines first and then runs smart-routing v2 with the optimized prompt. `map --headless --refine ...` is a question gate: when a router model is available, MAP first asks that model to generate task-specific questions that are not already answered by the request; in an interactive terminal it asks those questions and incorporates your answers into the refined prompt. Once clarification answers exist, MAP asks a short follow-up set focused on task-specific success conditions and verification evidence, then writes those answers into a **Definition of done** section so downstream planning, QA, and release-readiness agents have observable completion criteria. After answers are collected, MAP asks whether to implement immediately, save the refined spec for the next session, or print only. Saved specs are stored under the output folder at `.map/refine/refined-prompt.md` plus `.map/refine/refined-result.json`; starting another headless run with the same output folder prompts you to execute the saved spec, refine it further, or ignore it. In non-interactive use it prints the questions and stops unless a saved refine handoff already exists for the output folder; in that case `map --headless --refine ...` executes the saved spec instead of overwriting it with unanswered questions. Use `--silent` when automation needs machine-readable refinement JSON. Execution flags such as `--output-format`, `--open-output`, and `--graph` are ignored unless you choose immediate execution or use `--run`.

Evidence gates are configurable under `evidence`:

```yaml
evidence:
  enabled: true
  requiredAgents:
    - usage-classification-tree
    - researcher
    - classyfire-taxonomy-classifier
    - security-advisor
    - legal-license-advisor
    - release-readiness-reviewer
  currentClaimMaxSourceAgeDays: 730
  requireRetrievedAtForWebClaims: true
  blockUnsupportedCurrentClaims: true
```

The gate requires machine-readable Claim Evidence Ledgers from configured fact-critical agents, rejects high-risk current/commonness claims that lack direct current/recent support, and surfaces unresolved evidence findings in the **Evidence Verification** report section. If an evidence remediation retry still fails, MAP adds an evidence feedback loop to the live DAG before blocking downstream work: it schedules the best available evidence-gathering helper (usually `researcher`, otherwise a debugging helper), passes the rejected claims and gate findings to that helper, and retries the original step with the helper output as context. The original failed node is marked `recovered` when the retry passes, and rendered user reports count the passing replacement rather than showing superseded evidence failures as final errors; the pipeline graph still shows the `*-evidence-feedback-*` and `*-retry-*` nodes plus `feedback`/`recovery` edges so users can see the automatic remediation path. If a deterministic evidence gate passes cleanly, MAP skips the redundant LLM fact-checker for that step; medium evidence warnings still trigger fact-check review before downstream consumers.

Use `map evidence audit` to scan existing Markdown/JSON artifacts for Claim Evidence Ledgers without rerunning a pipeline:

```bash
map evidence audit ./output
map evidence audit ./output --json
```

The audit reports files with ledgers, total claims, deterministic evidence-gate findings, and stale/source-freshness details when available.


### Compact Output

Use `--compact` when you only want the utilized agent flow and the final answer. Compact is independent from `--output-format`: it reduces whichever selected format you choose to a stage-oriented graph plus final result. The graph groups steps by dependency layer so independent steps are shown as concurrent, downstream steps show their input step IDs, and consensus-enabled steps include the run count, method, participating provider/model, run number, status, and contribution.

````markdown
## Agent Graph

```text
Stage 1 (concurrent):
- step-1 [researcher] completed | consensus 3x exact-majority: ollama/gemma4:26b r1 contributed 100%; ollama/qwen2.5:14b r2 rejected 0%
- step-2 [data-loader] completed
Stage 2 (sequence):
- step-3 [writer] completed | inputs: step-1, step-2
Connections:
- step-1 -> step-3 (planned)
- step-2 -> step-3 (planned)
```

## Final Result

<final output from the last completed agent>
````

The graph is built from the runtime DAG after dynamic changes, so it includes adviser replans, recovery steps, automatic grammar/spelling polishing steps, and consensus metadata attached to the executed steps. Visual HTML/SVG DAG rendering supports six layouts: `auto` (default; stage for small/medium and matrix for large DAGs), `stage` (A layered stage swimlane), `metro` (B route/branch map), `matrix` (C role-by-stage grid), `cluster` (D summary-first grouped stages), and `circular` (E radial route map). Circular SVG output uses a larger zoomable canvas, curved colored dependency routes, and label backgrounds so multi-agent handoffs such as the QA panel remain readable without text overlap. PDF generation uses a terse pipeline summary for auto layout regardless of graph size, includes an agent-acronym legend below the summary, suppresses the full inline graph and steps table, and avoids embedding the duplicate `agent-network.svg` figure in the artifact gallery; explicit `--dag-layout` values still force the requested detailed inline layout.

`--graph` writes standalone graph image artifacts for all six supported layouts directly in the request output directory and adds `graphArtifacts` plus `graphArtifactManifestPath` to JSON/YAML output. PNG rendering uses Chrome/Chromium when available (`MAP_GRAPH_BROWSER` can point to a browser binary); when no compatible browser is found, MAP writes deterministic SVG fallbacks and records the reason in `graphWarnings`.

For ClassyFire/ChemOnt plus usage/LCB runs, compact Markdown/HTML/PDF reports preserve the two source reports as the customer-facing final result. Deterministic rendering combines the completed taxonomy and usage outputs instead of letting optional judge or formatter steps replace them with rubrics, candidate-selection notes, or lossy spreadsheet summaries.

For chemical taxonomy-plus-usage prompts, MAP treats router outputs that merely explain why `researcher` was skipped in favor of specialized taxonomy/usage agents as a recoverable routing hint, not as a terminal no-match. The deterministic fallback routes to `classyfire-taxonomy-classifier` and `usage-classification-tree`, and reports suppress that implementation-detail `researcher` skip rationale once the specialist plan is selected. This fallback is intentionally disabled for software-development or data-engineering requests, even when they mention PubChem, HMDB, Metabolomics Workbench, compounds, substances, or Markdown conversion; those should route through generic software delivery agents instead of chemical classification agents or hardcoded database-specific builders. Downloader/conversion software results must write actual non-empty data artifacts rather than empty placeholder records.

For other router no-match cases with a `suggestedAgent`, MAP first uses that agent directly when it already exists in the enabled registry; this prevents software-development prompts from degrading into generic researcher fallbacks. When the suggested agent does not exist, MAP attempts bounded autonomous agent discovery before falling back. It researches local Ollama/Hugging Face GGUF model candidates, rejects models that do not fit the detected local memory budget and configured Ollama load/concurrency settings, generates three candidate agent definitions, selects one with a local consensus judge, then pulls/verifies the selected hardware-fit model before writing the winner under `agents/<name>/`, reloading the registry, and rerouting. Discovery refuses to overwrite hand-written agents or unexpected existing agent directories. The recovery loop is capped at three discovery/reroute cycles per run; if it cannot produce a specialist route, MAP uses the best available fallback agent and reports degraded-success warnings rather than failing only because routing had no match.

Autonomous discovery diagnostics are included in human-readable and machine-readable outputs under **Autonomous Agent Discovery** / `agentDiscovery`, including selected model, rejected hardware/model candidates, generated agent path, consensus candidates, selected candidate, and warnings.

When HTML or PDF artifacts are written to disk, MAP also creates a `manifest.json` in the same request output directory as the HTML/PDF and deterministic SVG visuals. Current generated visuals include:

- `agent-network.svg`: the executed runtime DAG using the selected `--dag-layout`; `auto` renders a compact layered flowchart for small/medium DAGs and a matrix lane view for large DAGs. PDF reports generate this file for inspection but do not embed it as a second full-size figure because the inline pipeline summary is the print-safe DAG representation. Concurrent stages, edge types, and consensus-enabled nodes are visually distinguished where the layout supports them.
- `agent-network-{auto,stage,metro,matrix,cluster,circular}.png`: standalone agent-network graphs generated by `--graph` for all supported layouts in the same folder as the other outputs. If PNG rendering is unavailable, SVG files with the same layout suffix are written instead.
- `usage-commonness-ranking.svg`: a 0-100 commonness score bar chart when a usage agent emits `Usage Commonness Ranking`.
- `taxonomy-tree.svg`: a ClassyFire/ChemOnt hierarchy diagram when a taxonomy table is present.

These visuals are derived from validated run data and are embedded as figures in the HTML/PDF report. Decorative AI-generated images should remain separate from evidence graphics and must be labeled as decorative.

### Verbose Progress

Pass `--verbose` (or `-V`) to emit human-readable progress on stderr while pretty-printed JSON goes to stdout. By default MAP also prints the final output directory to stderr after a headless run; pass `--silent` to suppress all non-format status/path output, with `--silent` taking precedence over `--verbose`. Verbose mode reports each DAG step, router-selected agents, router-skipped agents, helper agents added during execution, why optional helpers such as fact-checkers or grammar reviewers were not needed, why retries or recovery loops are scheduled, why MAP cannot recover automatically when no helper/model is available, and router self-recovery events such as generated-agent reroutes and Ollama model preparation/pulls. When stderr supports color, verbose output highlights each agent and step with stable distinct colors, highlights selected/skipped/added decisions and QA/review verdicts, and renders every failure in red with an indented one-line `↳ Why:` reason below the failure headline so errors are easy to spot. Security gate failures also print each finding as an indented line with severity, rule, message, line, and snippet when available. Useful for cron logs and daemon monitoring:

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
npm run dev -- --headless \
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
| Ollama | `curl -fsSL https://ollama.com/install.sh \| sh` | Local model backend. MAP can start the server with configured resource env vars and pull/update configured models before use. |
| Hermes | Install Hermes CLI and keep `hermes` on `PATH` | Optional adapter for `hermes chat -q ... -Q` workflows. |

For Ollama-backed agents, `model` is required. If an Ollama-backed stage, router, security reviewer, or v2 agent runs and the server is not available, MAP starts `ollama serve` in the background, waits for it to respond, then runs `ollama pull <model>`. Pulling installs a missing model and refreshes an existing tag. MAP does this once per distinct model/host/server-settings tuple per process run.

MAP starts Ollama with local-agent defaults intended for coding and agent workflows:

```yaml
ollama:
  host: http://localhost:11434
  contextLength: 100000    # OLLAMA_CONTEXT_LENGTH
  numParallel: 2           # OLLAMA_NUM_PARALLEL
  maxLoadedModels: 2       # OLLAMA_MAX_LOADED_MODELS
```

Override those values in `pipeline.yaml` or per run with `--ollama-host`, `--ollama-context-length`, `--ollama-num-parallel`, and `--ollama-max-loaded-models`. Higher context and concurrency settings require more RAM/VRAM; if a server is already running, Ollama keeps the settings it was started with.

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
  contextLength: 100000
  numParallel: 2
  maxLoadedModels: 2

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
map --headless "Research the task, plan the steps, and assess readiness"
```

The router uses the registered agents' `name`, `description`, `handles`, `output.type`, and role contract summary to produce JSON. For coding workflows, a reviewed and QA-approved specification should pass through `adviser` before execution agents so the launch order, parallelizable lanes, custom-agent needs, and registry-refresh requirements are explicit:

```json
{
  "plan": [
    { "id": "step-1", "agent": "spec-writer", "task": "Create an implementation-ready specification", "dependsOn": [] },
    { "id": "step-2", "agent": "spec-qa-reviewer", "task": "Review the specification for ambiguity, missing tests, and implementation risk", "dependsOn": ["step-1"] },
    { "id": "step-3", "agent": "adviser", "task": "Recommend the best agent launch workflow from the reviewed and QA-approved spec", "dependsOn": ["step-2"] },
    { "id": "step-4", "agent": "tdd-engineer", "task": "Write failing tests from the reviewed specification", "dependsOn": ["step-3"] },
    { "id": "step-5", "agent": "implementation-coder", "task": "Implement the behavior", "dependsOn": ["step-4"] },
    { "id": "step-6", "agent": "code-qa-analyst", "task": "Review implementation quality and test adequacy", "dependsOn": ["step-5"] }
  ]
}
```

Steps with no unmet dependencies run concurrently. Dependent steps receive previous step outputs as context. If a dependency fails, downstream steps are skipped with a clear reason.

### Router Plan Hygiene and Consensus

MAP cleans router-produced task text before a plan is displayed or executed. This catches common local-model failure modes such as repeated tokens, slash-delimited loops, and overlong task fields. Mild repetition is collapsed into a readable task; fully degenerate task text is rejected so agents do not execute nonsense plans.

For Ollama routers, MAP runs a small consensus pass by default. With `models: []`, MAP repeats `router.model` three times and keeps the majority-agreed plan. Before routing and DAG execution, MAP probes the local Ollama server with small streaming requests to estimate how many requests can make progress concurrently. Router consensus and ready local-model DAG steps then use that detected concurrency limit, falling back to one-at-a-time execution when probing fails or the server behaves serially. To diversify the router vote, list up to three local models in `pipeline.yaml`:

```yaml
router:
  adapter: ollama
  model: gemma4:26b
  consensus:
    enabled: true
    models:
      - gemma4:26b
      - qwen3:latest
      - llama3.1:8b
    scope: router
    mode: majority
```

Router consensus applies to DAG planning. MAP asks each listed model for a DAG plan, parses and cleans each result, drops invalid or degenerate candidates, then uses majority-agreed plan steps when at least two models match. If there is no majority, MAP falls back to the best valid cleaned plan. If all candidates fail, routing fails with per-model rejection reasons.

### Local Agent Hallucination Controls

All first-party agent prompts receive shared conduct rules that require claims to be grounded in provided context, retrieved evidence, tool output, or clearly labeled assumptions. They also explicitly forbid fabricated citations, file paths, command output, test results, and verification evidence.

For repeatability, Ollama defaults run with deterministic sampling:

```yaml
adapterDefaults:
  ollama:
    think: false
    temperature: 0
    seed: 42
```

When deterministic Ollama options are active, MAP uses Ollama's chat API in streaming mode so long-running local generations still emit progress chunks and can be cancelled or timed out cleanly.

MAP can also repeat non-file agent outputs and select the best-supported candidate. Global non-file consensus is opt-in because repeating heavyweight local models can make runs slower, but critical fact-producing agents use per-agent consensus by default. In addition, research and usage-classification outputs automatically receive an independent fact-checking handoff when the corresponding fact-checker agent is enabled:

```yaml
agentConsensus:
  enabled: false
  runs: 3
  outputTypes: [answer, data, presentation]
  minSimilarity: 0.35
  perAgent:
    researcher:
      enabled: true
      runs: 3
      outputTypes: [answer]
    classyfire-taxonomy-classifier:
      enabled: true
      runs: 3
      outputTypes: [answer]
    usage-classification-tree:
      enabled: true
      runs: 3
      outputTypes: [answer]
```

Set `agentConsensus.enabled: true` when the added quality check is worth the extra runtime for all non-file agents. `answer`, `data`, and `presentation` outputs are safe to repeat because they do not write files directly. File-producing implementation agents are intentionally excluded from automatic repetition to avoid multiple concurrent edits in the same workspace; they remain protected by TDD, security, handoff validation, code QA, and release-readiness agents. When non-file candidates disagree below `minSimilarity`, MAP fails the step instead of silently picking a hallucinated outlier.

Fact-checking agents use a different model by default (`bespoke-minicheck:7b`) and return a required `Fact-check verdict: supported | rejected | needs-review`. A `rejected` verdict fails the fact-check step and blocks downstream consumers; `needs-review` is surfaced as a warning so downstream agents can treat the source claims cautiously. Fact-check outputs are appended to rendered reports under **Fact-check Verification** without replacing the original research or usage report.

When an Ollama `seed` is configured, consensus candidates use stable seed offsets (`seed`, `seed + 1`, `seed + 2`, ...). This keeps repeated MAP runs reproducible while still allowing diversity if you choose a non-zero temperature.

File-producing agents can also use consensus, but they execute through isolated git worktrees instead of repeating in the active workspace:

```yaml
agentConsensus:
  fileOutputs:
    enabled: true
    runs: 3
    isolation: git-worktree
    keepWorktreesOnFailure: true
    verificationCommands:
      - npm run typecheck
      - npm run test:core
    selection: best-passing-minimal-diff
```

Execution order for file-output consensus:

1. MAP uses the target working directory as the baseline. If it is exactly a git checkout root, the checkout must be clean. If it is an ignored output directory or non-git directory, MAP creates a temporary baseline git repository from its current contents.
2. MAP creates candidate worktrees under `.map/worktrees/consensus/<step>/` for real repo roots, or under a temporary baseline repository for output directories.
3. Each candidate runs the same file-producing agent from the same `HEAD`, with stable seed offsets.
4. Each candidate stages its own changes inside its worktree, captures a binary patch, and runs `verificationCommands`.
5. MAP selects the verified candidate with the fewest changed files and smallest patch.
6. MAP applies the selected patch back to the original checkout.
7. MAP reruns the same verification commands in the original checkout before marking the step complete.

Worktrees are kept on failure when `keepWorktreesOnFailure` is true so the rejected candidates can be inspected. They are removed after successful selection. File-output consensus intentionally requires a clean checkout only when operating directly on a repository root; this prevents candidates from accidentally omitting or overwriting uncommitted user changes while still supporting ignored generated-output directories.

Every consensus path reports diagnostics in the result graph/report. Reports include the participating provider/model per run, whether that run contributed, was selected, was merely valid, was rejected, or failed, and a contribution percentage. Consensus-enabled DAG nodes also surface the run count, method, run models, statuses, and contributions directly in compact graphs and selected `agent-network.svg` layouts. Router consensus contribution means the candidate supplied selected DAG steps. Agent-output consensus contribution means the candidate matched or was closest to the selected final output. File-output consensus contribution identifies the patch that passed verification and was applied.

### Autonomous cross-model review

### Three-model QA panel

Software implementation QA is expanded at execution time into three independent model reviewers before consensus: `code-qa-gemma` (`gemma4:26b`), `code-qa-qwen` (`qwen3.6:latest`), and `code-qa-glm` (`glm-4.7-flash:latest`, the local Kimi-slot alternative until a Kimi Ollama model is installed). The original `code-qa-analyst` step becomes a deterministic consensus gate: all three model verdicts must accept and local generated-project tests must pass, otherwise MAP sends the work back to the developer repair loop with combined findings.

MAP enables cross-model review for runtime-enforced high-impact software-delivery gates by default. The always-on gates are adviser planning outputs, file-changing agents, security-sensitive outputs, and release-readiness. A proposer can plan or change files, a different model critiques the proposal, and a hybrid judge decides the next autonomous action. Disagreement does not ask the user to pick a model opinion; instead MAP creates bounded remediation work, runs or requests verification through remediation where available, and records the decision trail in output. Routing remains handled by router consensus; the `routing`, `architecture`, `apiContract`, and `verificationFailure` keys remain config surface for future cross-review expansion, but they are not described here as always-on gates.

The default remediation budget is two judge-steered rounds, capped at five. Configured judge models drive cross-review helper model overrides, and reviewer/judge roles remain distinct when possible so the critique path is not the same as the arbitration path. Outputs include `crossReview` metadata so downstream tooling can inspect the gate, judge, and remediation state.

Use `--disable-cross-review` for a single run, `--cross-review-max-rounds <n>` to tune remediation depth, and `--cross-review-judge-models <csv>` to choose hybrid judges such as `ollama/gemma4:26b,ollama/qwen3.6`. Currently only the first two entries are used: the first drives peer review, the second drives the judge, a single entry drives the judge, and additional entries are ignored or reserved.

```yaml
crossReview:
  enabled: true
  defaultHighImpactOnly: true
  maxRounds: 2
  autonomy: nonblocking
  judge:
    preferSeparatePanel: true
    models: []
  gates:
    planning: true
    routing: false # reserved for future cross-review expansion; router consensus protects routing today
    architecture: false # reserved for future/expanded routing
    apiContract: false # reserved for future/expanded routing
    fileOutputs: true
    security: true
    releaseReadiness: true
    verificationFailure: false # reserved for future/expanded routing
```

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
- `builtin: http-api` for configured REST/GraphQL-style endpoints.
- `builtin: db-connection` for read-only PostgreSQL queries through `psql`.
- `mcp` for MCP servers reachable over HTTP-style endpoints; these are exposed through generated `mcp-*` JSON-RPC proxy tools.

Built-ins currently include `shell`, `file-read`, `web-search`, `knowledge-search`, `http-api`, and `db-connection`.

Goal and project-memory support is provided by two first-party agents:

- `goal-synthesizer` runs early for software, research, or ambiguous tasks when available. It combines refined prompt content, local `knowledge-search` entries, and web search when current external behavior matters to produce a goal understanding, non-goals, assumptions, and an observable definition of done.
- `project-knowledge-curator` runs near the end of multi-step work or after major milestones. MAP persists its output, plus goal-synthesizer output, under `<outputDir>/knowledge/` as per-task memory (`goal.md` and `progress-log.md`) so later agents and future sessions can reuse project-specific goals, assumptions, code/artifact facts, decisions, and verification evidence. When the curator follows the main deliverable, router plans should mark the main deliverable or readiness step with `final:true` so final reports remain user-facing rather than memory-maintenance prose.

Deployment overrides live in `pipeline.yaml` under `agentOverrides`. Scalar fields replace the agent definition; tools are merged by name.

```yaml
agentOverrides:
  implementation-coder:
    model: qwen2.5-coder:14b
  docs-maintainer:
    enabled: false
```

## Adviser Workflow Gate

`adviser` is the adaptive planning gate for coding work that already has a reviewed and QA-approved spec. It does not implement the feature. Instead, it reads the approved spec and can return a machine-readable `adviser-workflow` that replaces the pending downstream DAG before coding begins.

Use `adviser` to decide:

- which existing agents to launch;
- the safest launch order and DAG dependencies;
- which steps can run in parallel;
- whether specialized custom agents should be created for uncovered work lanes;
- whether the agent registry/list must be refreshed before downstream execution.

When `adviser` returns JSON like this, MAP refreshes the agent registry when requested, removes pending downstream steps from the current DAG, and executes the replacement workflow:

```json
{
  "kind": "adviser-workflow",
  "refreshAgents": true,
  "plan": [
    { "id": "step-4", "agent": "tdd-engineer", "task": "Write failing tests from the reviewed specification", "dependsOn": ["step-3"] },
    { "id": "step-5", "agent": "implementation-coder", "task": "Implement the behavior covered by the tests", "dependsOn": ["step-4"] },
    { "id": "step-6", "agent": "code-qa-analyst", "task": "Review implementation quality and test adequacy", "dependsOn": ["step-5"] }
  ]
}
```

This makes the agent network dynamic at runtime: the initial router plan can deliberately stop at `adviser`, and `adviser` can reshape the rest of the workflow after inspecting the approved spec and any newly created agents.

A typical feature path is:

```text
spec-writer
  -> spec-qa-reviewer
  -> adviser
  -> tdd-engineer
  -> implementation-coder
  -> code-qa-analyst
  -> legal-license-advisor
  -> docs-maintainer / stabilization-reviewer / release-readiness-reviewer as needed
```

If the spec is not clearly reviewed and QA-approved, `adviser` should route back to spec QA instead of recommending execution.




### Real LLM Agent Integration Tests

Real LLM agent integration tests validate selected agents against a live Ollama model. Most broad live-agent contract tests stay in explicit suites because they depend on local model availability and can legitimately take longer than deterministic unit tests. The customer-facing cocaine taxonomy/usage report regression is intentionally always-on so failures in the standard report path are visible instead of hidden behind an environment flag.

Run just the general LLM contract suite with:

```bash
npm run test:llm-agents
npm run test:e2e-cocaine-report
```

`npm run test:e2e-cocaine-report` runs the standard cocaine classification/taxonomy/usage PDF+graph command path without an opt-in environment variable and uses a 15 minute timeout wrapper. By default the general LLM contract suite uses each agent's configured Ollama model. Override it with:

```bash
MAP_LLM_TEST_MODEL=gemma4:26b npm run test:llm-agents
```

These tests exercise the grammar/spelling, ClassyFire/ChemOnt taxonomy, usage-classification, and researcher contracts with real model output. They require local Ollama/model availability and should fail loudly if the model runtime is unavailable.

### Classification Agents

MAP includes two separate classification specialists:

- `classyfire-taxonomy-classifier` produces ClassyFire/ChemOnt-style chemical ontology trees. It must never use the ClassyFire API; that API is treated as broken/unreliable for this workflow.
- `usage-classification-tree` produces evidence-backed usage trees, an LCB-ready exposure summary, and a Usage Commonness Ranking. It categorizes whether an entity is a drug/drug metabolite, food compound/food metabolite, household chemical, industrial chemical, pesticide, personal-care-product compound, other exposure-origin compound, or cellular endogenous compound. For positive categories, it reports up to three typical diseases, foods, use areas, species, and organs/tissues as applicable, using `unavailable` instead of inventing unsupported entries. Usage Tree rows use unique identifiers; repeated depths are branch-suffixed (for example, `Level 2.1`, `Level 2.2`) rather than reusing the same bare `Level 2` identifier. It also ranks supported usage applications or exposure origins by an ordinal 0-100 commonness score plus a label (`very common`, `common`, `less common`, `rare`, or `unavailable`), and every individual positive LCB Exposure Summary usage scenario and important Usage Tree scenario is represented in the ranking even when the score is `unavailable`; prompts that request the top N rows are honored after preserving those positive-category rows. Commonness means current prevalence/exposure, so historical, obsolete, discontinued, or mainly centuries-old practices must be down-weighted and marked with timeframe plus recency/currentness evidence instead of being treated as common today. Medical/metabolomics usage runs prefer PubMed/NCBI, DrugBank/PubChem/ChEBI/HMDB/KEGG/ChEMBL/MeSH/NCBI record, FDA/DailyMed label, metabolomics resource record, or PMID/DOI-backed evidence, keep `Evidence`/`Commonness evidence` separate from `Caveat`, and allow rows where database/publication records support a usage but commonness remains `unavailable` because prevalence, adoption, utilization, or testing-frequency evidence is missing. Short customer-facing medical/metabolomics prompts are capped at two web searches, stay inside the requested medical/metabolomics domains, and must not assign high commonness scores to restricted clinical or metabolomics/detection-only contexts. Concrete database/regulatory/publication record IDs and URLs should be cited whenever available.
- Usage outputs must include a machine-readable `Claim Evidence Ledger`; MAP rejects fact-critical usage outputs before downstream use when the ledger is missing, when high current commonness scores lack current/recent evidence, or when historical/obsolete practices are scored as common today. Persistent evidence failures trigger an evidence feedback loop that gathers/downgrades the missing evidence and retries the usage agent before downstream rendering.
- Web-search findings are treated as leads, not ground truth. When the verification agents are available, fact-critical usage/research outputs receive a three-agent review panel before downstream consumers run: the domain fact-checker verifies usage/research claims, `evidence-source-reviewer` checks cited database/publication/regulatory records and source diversity, and `commonness-evidence-reviewer` checks prevalence/utilization/adoption/testing-frequency proxy evidence and unavailable-commonness decisions.

Keep these outputs separate: ClassyFire/ChemOnt is chemical taxonomy, while usage classification describes what an entity is used for. MAP's compact report renderer knows this pairing and will display both reports together when both branches complete, even if a downstream judge/formatter step exists in the graph.

### Automatic Text Polishing

Whenever a DAG step produces human-facing text (`answer` or `presentation` output), MAP automatically schedules `grammar-spelling-specialist` immediately after that step when the agent is available. Pending downstream steps are rewired to depend on the polished output, so later agents consume corrected prose instead of raw model text.

This post-processing does not run for code/file outputs, machine-readable JSON, adviser workflow JSON, or the grammar specialist itself. Its job is limited to grammar, spelling, punctuation, readability, and visible terminal-artifact cleanup without changing technical meaning.

## Built-In Agents

MAP ships with a software-delivery bundle. These agents default to `adapter: ollama` and `model: gemma4:26b`:

| Agent | Output | Handles |
| --- | --- | --- |
| `software-delivery` | `files` | Full spec -> QA -> TDD -> implementation -> code QA lifecycle. |
| `spec-writer` | `answer` | Requirements, acceptance criteria, constraints, implementation-ready specs. |
| `spec-qa-reviewer` | `answer` | Spec ambiguity, missing tests, edge cases, implementation risk. |
| `adviser` | `answer` | Reviewed/QA-approved spec workflow advice, agent launch order, custom-agent and registry-refresh recommendations. |
| `tdd-engineer` | `files` | Test plans and failing tests from acceptance criteria. |
| `implementation-coder` | `files` | Minimal code changes that satisfy tests and reviewed specs. |
| `code-qa-analyst` | `answer` | Code QA, maintainability, test adequacy, spec conformance. |
| `code-qa-gemma` | `answer` | Independent Gemma model QA verdict for software implementations. |
| `code-qa-qwen` | `answer` | Independent Qwen model QA verdict for software implementations. |
| `code-qa-glm` | `answer` | Independent GLM/Kimi-slot model QA verdict for software implementations. |
| `legal-license-advisor` | `answer` | Deterministic post-build license option recommendations from utilized languages, package manifests, existing license files, and local evidence ledger. |
| `grammar-spelling-specialist` | `answer` | Automatic grammar, spelling, punctuation, readability, and terminal-artifact cleanup for generated text. |
| `output-formatter` | `answer` | Optional LLM formatter for custom report transformations. Disabled by default; MAP's deterministic local renderers handle normal Markdown/HTML/PDF output. |
| `usage-classification-tree` | `answer` | Evidence-backed usage trees plus LCB-ready exposure summaries and commonness rankings/scores for drugs/metabolites, food compounds/metabolites, household/industrial chemicals, pesticides, personal-care compounds, other exposure origins, and endogenous compounds. |
| `usage-classification-fact-checker` | `answer` | Independent fact-checking for usage/LCB/commonness claims using `bespoke-minicheck:7b`; rejects unsupported or recency-inconsistent usage reports before downstream use. |
| `research-fact-checker` | `answer` | Independent fact-checking for researcher outputs using `bespoke-minicheck:7b`; flags or rejects unsupported research claims. |
| `classyfire-taxonomy-classifier` | `answer` | ClassyFire/ChemOnt chemical taxonomy trees without using the broken ClassyFire API. |
| `prompt-refiner` | `data` | Socratic prompt refinement with Teacher/Critic/Student framing and readiness scores. |
| `insightcode-metadata` | `data` | Deterministic read-only metadata generator inspired by InsightCode; emits source summaries and architecture sketches for downstream LLM context. |
| `codefetch-metadata` | `data` | Deterministic read-only metadata generator inspired by CodeFetch; emits Markdown file tree and compact source context without editing files. |
| `codesight-metadata` | `data` | Deterministic read-only metadata generator inspired by CodeSight; maps files, symbols, imports, and exports for LLM codebase understanding. |
| `bug-debugger` | `answer` | Reproduction, root cause, regression-safe fix plans. |
| `build-fixer` | `files` | Build, typecheck, lint, and toolchain failures. |
| `test-stabilizer` | `files` | Flaky, brittle, missing, or low-signal tests. |
| `refactor-cleaner` | `files` | Behavior-preserving cleanup using existing patterns. |
| `docs-maintainer` | `files` | Deterministic post-build README, license coverage, and Markdown docs updates after implementation and QA. |
| `stabilization-reviewer` | `answer` | Capability truth, spec/doc mismatch checks, integration risks, and hardening recommendations. |
| `release-readiness-reviewer` | `answer` | Deterministic final readiness, evidence, risk, and handoff status with Claim Evidence Ledger. |

Example DAG flows are documented in [docs/agents/software-delivery-flows.md](docs/agents/software-delivery-flows.md).

For self-orientation, use [docs/agents/tool-explorer.md](docs/agents/tool-explorer.md) to ask MAP what it can do, which mode fits a task, and which agents or commands to inspect next.

## Agent CLI

Agent definitions can be inspected and generated from the CLI:

```bash
map agent list
map agent test implementation-coder
map agent test implementation-coder --prompt "Summarize how you would implement a small CLI"
map agent edit implementation-coder
map agent create --adapter ollama --model gemma4:26b
```

`map agent list` loads `agents/` and prints each agent's adapter, model, output type, pipeline, and tool count.

`map agent test <name>` validates the agent definition, builds a tool-aware smoke-test prompt, and runs the agent adapter with an optional sample task.

`map agent edit <name>` opens `agents/<name>/prompt.md` in `$EDITOR` or `$VISUAL`.

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
  consensus:
    enabled: false
    models: [] # up to 3 Ollama models, e.g. [gemma4:26b, qwen3:latest, llama3.1:8b]
    scope: router
    mode: majority
  maxSteps: 10
  timeoutMs: 5m

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
  contextLength: 100000
  numParallel: 2
  maxLoadedModels: 2

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
  map --headless "idea"  Run non-interactively, outputs pretty JSON to stdout
  map --classic "idea"   Use the classic fixed-stage pipeline
  map --spec-file <path> Start from a local spec file
  map --github-issue <url>
                         Use a GitHub issue as prompt and post final report
  map agent list         List registered agents
  map agent create       Generate a new agent definition
  map agent test <name>  Run one agent with a smoke-test prompt
  map agent edit <name>  Edit one agent prompt
  map evidence audit     Audit Claim Evidence Ledgers in existing artifacts

Options:
  --help, -h             Show help
  --version, -v          Show version
  --config <path>        Path to pipeline.yaml config
  --resume [id]          Resume a saved pipeline
  --headless             Run without TUI, print result to stdout
  --classic              Use the classic fixed-stage pipeline
  --spec-file <path>     Use a local spec file as input
  --v2                   Deprecated compatibility flag; smart routing is the default
  --output-dir <path>    Output directory for generated reports and artifacts
  --workspace-dir <path> Execute agents in an existing project/data directory (alias: --target-dir)
  --output-format <fmt>  Print result as json, yaml, markdown, html, text, or pdf
  --silent               Suppress non-format status/path output; stdout stays pipe-safe
  --open-output          Open generated html/pdf output automatically
  --compact              Reduce output to agent graph and Final Result
  --graph                Write PNG agent-network graphs for all DAG layouts
  --dag-layout <layout>  Force DAG visualization: auto, stage, metro, matrix, cluster, circular
  --total-timeout <dur>  Total headless runtime budget, e.g. 60m
  --inactivity-timeout <dur>
                         Stall timeout since last stage activity, e.g. 10m
  --poll-interval <dur>  Internal polling cadence for timeout checks, e.g. 10s
  --router-timeout <dur> Router planning timeout, e.g. 300s
  --router-model <name>  Override the smart-routing router model
  --router-consensus-models <csv>
                         Override router consensus with up to 3 Ollama models
  --disable-agent <csv>  Disable one or more smart-routing agents for this run
  --compare-agents [csv]
                         Run ablation comparisons for selected agents
  --semantic-judge       Add deterministic semantic comparison scores
  --judge-panel-models <csv>
                         Run an LLM judge panel with the listed models
  --judge-panel-roles <csv>
                         Assign adversarial judge roles
  --judge-panel-steer    Allow judge-panel feedback to steer reruns
  --judge-panel-max-rounds <n>
                         Max judge-panel steering reruns
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
npm run test:tui
npm run test:ci
npm run typecheck
npm run build
```

Verification baseline:

- `npm test` / `npm run test:core`: core suite, excluding `tests/tui/**`, `tests/spike/**`, and broad live LLM integration tests; includes the always-on cocaine report e2e regression so customer-report failures surface by default, verifies that required software-workflow Ollama models can be prepared/downloaded, and serializes core test files so live model work does not starve short unit tests
- `npm run test:tui`: TUI suite through `scripts/run-with-timeout.mjs` with a 60s process timeout and 10s Vitest test/hook timeouts
- `npm run test:spike`: opt-in exploratory spike tests through the same timeout wrapper
- `npm run test:llm-agents`: opt-in live Ollama agent contract tests through a 15 minute process timeout
- `npm run test:e2e-cocaine-report`: always-on live standard cocaine classification/taxonomy/usage report regression through a 15 minute process timeout
- `npm run test:all`: raw `vitest run` for local debugging when you explicitly want every suite in one process
- `npm run test:ci`: `typecheck` + `test:core` + `test:tui`
- `npm run typecheck`
- `npm run build`

The split exists because terminal UI tests use alternate-screen and event-loop behavior that can stall an otherwise healthy verification run. Core tests stay mostly deterministic, with the standard cocaine report e2e retained as an always-on real-world regression; TUI/spike/broad LLM tests remain available but are isolated behind hard timeouts.

## Roadmap

The v2 foundation is now in place. Useful next steps:

- Token usage tracking per stage and per DAG step.
- Retry/failover policies for quota or transient backend failures.
- Mid-stage resume instead of only stage-boundary checkpoints.
- Full interactive v2 approval/editing flow in the TUI.
- Browser-based UI for long-running pipelines.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE) for the full license text.

Redistributed copies and modified versions must preserve the copyright,
license, and attribution notices required by the GPL. If you publish work
that builds on MAP, cite or reference this project:

> Multi-Agent Pipeline (MAP), https://github.com/berlinguyinca/multi-agent-pipeline
