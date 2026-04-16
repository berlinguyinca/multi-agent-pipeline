# MAP Agent Operating Notes

This repository is **multi-agent-pipeline (MAP)**. It orchestrates local and CLI-backed agents through either a classic fixed pipeline or smart-routing DAG execution.

## Core execution model

- Agent definitions live in `agents/<name>/agent.yaml` plus `prompt.md`.
- `src/agents/loader.ts` loads agent YAML, prompt Markdown, tools, fallbacks, `think`, and structured role contracts.
- `src/utils/agent-conduct.ts` is prepended to all loaded agent prompts. Keep hallucination guardrails there when a rule must apply to every local agent.
- `src/router/prompt-builder.ts` builds the smart-routing prompt from enabled agents and role contract summaries.
- `src/router/router.ts` parses/cleans/validates router JSON and performs router consensus.
- `src/orchestrator/orchestrator.ts` executes DAG steps, injects tool catalogs, handles retries/recovery, security gates, handoff validation, grammar review, adviser replans, and output consensus.
- `src/headless/runner.ts` and `src/tui/tui-app.ts` wire config into routing and DAG execution.

## Repeatability and anti-hallucination controls

MAP is intentionally consensus-first for local model quality:

1. **Router consensus** is enabled by default. If `router.consensus.models` is empty, MAP repeats `router.model` three times and keeps majority-agreed plan steps.
2. **Non-file agent consensus** repeats `answer`, `data`, and `presentation` outputs and selects exact-majority or token-similarity medoid output. If agreement is below `agentConsensus.minSimilarity`, the step fails instead of accepting a likely hallucinated outlier.
3. **File-output agent consensus** is available through isolated git worktrees via `agentConsensus.fileOutputs`. Candidate worktrees run from the same clean `HEAD`, produce patches, run configured verification commands, and the best verified/minimal patch is applied back to the original checkout.
4. **Ollama repeatability** uses deterministic defaults: `think: false`, `temperature: 0`, `seed: 42`. Consensus candidates use stable seed offsets (`seed`, `seed + 1`, `seed + 2`, ...).
5. **Prompt evidence discipline** belongs in `src/utils/agent-conduct.ts`: do not fabricate citations, file paths, tool results, command output, test results, or verification evidence.

Do not remove these controls casually. If changing them, update README and tests in the same change.

Consensus diagnostics are part of the reporting contract. Results should show every provider/model used for consensus, each run number, status (`contributed`, `selected`, `valid`, `rejected`, or `failed`), and contribution percentage. Router contribution means selected DAG-step overlap. Agent-output contribution means agreement/similarity with the selected output. File-output contribution means the verified patch selected for application.

## File-output consensus worktree flow

When `agentConsensus.fileOutputs.enabled` is true for a `files` agent:

1. Require the target working directory to be a clean git checkout.
2. Create candidate worktrees under `.map/worktrees/consensus/<step>/`.
3. Run the file-producing agent once per candidate worktree.
4. Stage candidate changes inside each worktree and collect `git diff --cached --binary HEAD`.
5. Run `agentConsensus.fileOutputs.verificationCommands` in each candidate.
6. Select the verified candidate with the fewest changed files and smallest patch.
7. Apply the selected patch to the original checkout.
8. Rerun the verification commands in the original checkout.
9. Keep candidate worktrees on failure when `keepWorktreesOnFailure` is true; otherwise clean them up.

This avoids multiple agents writing into the same workspace and makes implementation consensus evidence-based instead of prose-based.

## Test commands

- `npm test` runs `npm run test:core`.
- `npm run test:core` runs stable deterministic tests via `vitest.core.config.ts`; it excludes TUI, spike, and live LLM integration tests.
- `npm run test:tui` runs TUI tests through `scripts/run-with-timeout.mjs` and `vitest.tui.config.ts`.
- `npm run test:spike` runs exploratory spike tests separately with a timeout.
- `npm run test:llm-agents` runs live Ollama agent integration tests explicitly through a 120s timeout wrapper.
- `npm run test:all` runs raw `vitest run` for local debugging only.
- `npm run test:ci` runs typecheck, core tests, and TUI tests.
- `npm run build` must pass before claiming implementation completion.

The split exists because TUI/alternate-screen tests and live local-model tests can stall a full raw Vitest process. Keep TUI, spike, and live LLM tests isolated behind explicit commands/timeouts.

## Documentation rule

This app should be self-documenting. Any change to routing, consensus, agent contracts, verification, or execution flow must update:

- `README.md` for user-facing behavior and commands.
- This `AGENTS.md` for future coding-agent context.
- Tests covering the changed behavior.
