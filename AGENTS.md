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
- Smart-routing execution may separate `outputDir` (MAP reports/artifacts) from `workspaceDir` (agent cwd for existing source/data). Agents should inspect and integrate with `workspaceDir`; do not assume report artifacts are the target application.
- Source metadata generator agents (`insightcode-metadata`, `codefetch-metadata`, `codesight-metadata`) are deterministic, non-LLM, read-only agents. They must generate codebase metadata only and must not modify source files.

## Visual artifact contract notes

- Deterministic visuals belong in `output/artifacts/` with a manifest, not inline base64 in prompts or Markdown.
- Agents should produce source data; code should generate evidence visuals such as agent networks, usage commonness plots, and taxonomy diagrams.
- Generated SVG must be sanitized and derived from run data. Treat AI-generated raster images as decorative unless explicitly validated as evidence.

## Classification agent contract notes

- `agents/classyfire-taxonomy-classifier` is limited to ClassyFire/ChemOnt-style chemical taxonomy and must not mix in usage, exposure, anatomical target, or indication claims.
- `agents/usage-classification-tree` owns usage and exposure reporting. It must include an LCB-ready exposure summary with yes/no/unavailable categories for drug/drug metabolite, food compound/food metabolite, household chemical, industrial chemical, pesticide, personal-care-product compound, other exposure origins, and cellular endogenous compound. Positive categories should include no more than three typical diseases, foods, use areas, species, or organs/tissues as applicable, and unsupported entries must be marked unavailable rather than invented. It must also include evidence-backed commonness rankings with 0-100 ordinal scores and labels, sorted descending and truncated to a requested top N when the prompt asks for one. Commonness means current prevalence/exposure, not mere historical existence: historical, obsolete, discontinued, or mainly centuries-old practices must be down-weighted and marked with timeframe plus recency/currentness evidence. This ranking is classification data only; the agent must not perform downstream report formatting or custom presentation transformations.
- Usage classification reports must include a machine-readable Claim Evidence Ledger. MAP's evidence gate blocks fact-critical usage outputs before downstream use when the ledger is missing, high current/common scores lack current or recent evidence, high-confidence claims rely only on model priors, or historical/obsolete practices are scored as common today.
- Fact-critical agents configured in `evidence.requiredAgents` must emit Claim Evidence Ledgers. Default required agents are `usage-classification-tree`, `researcher`, `classyfire-taxonomy-classifier`, `security-advisor`, and `release-readiness-reviewer`. Evidence gates must use freshness settings such as `currentClaimMaxSourceAgeDays`, `requireRetrievedAtForWebClaims`, and `blockUnsupportedCurrentClaims`.
- `agents/output-formatter` is disabled by default because LLM formatting repeatedly dropped protected scientific labels/terms. Use deterministic local Markdown/HTML/PDF renderers for normal reports; re-enable `output-formatter` only for explicit custom transformation tasks.

## Repeatability and anti-hallucination controls

MAP uses consensus selectively for local model quality without making heavyweight local runs appear stalled:

1. **Router consensus** is enabled by default. If `router.consensus.models` is empty, MAP repeats `router.model` three times and keeps majority-agreed plan steps. MAP probes Ollama concurrency at runtime and uses the detected local-model parallelism for router consensus and ready DAG step scheduling, falling back to one-at-a-time execution for single-connection installations.
2. **Non-file agent consensus** is globally opt-in via `agentConsensus.enabled`, with per-agent overrides under `agentConsensus.perAgent`. `researcher`, `classyfire-taxonomy-classifier`, and `usage-classification-tree` must run per-agent consensus by default because they are fact-critical. When enabled, consensus repeats `answer`, `data`, and `presentation` outputs and selects exact-majority or token-similarity medoid output. If agreement is below `agentConsensus.minSimilarity`, the step fails instead of accepting a likely hallucinated outlier.
   Research and usage-classification outputs should also be independently checked by `research-fact-checker` or `usage-classification-fact-checker` when those agents are available. These fact-checkers intentionally use `bespoke-minicheck:7b`; rejected verdicts block downstream consumers, while needs-review verdicts are warning context.
3. **File-output agent consensus** is available through isolated git worktrees via `agentConsensus.fileOutputs`. Candidate worktrees run from the same clean `HEAD`, produce patches, run configured verification commands, and the best verified/minimal patch is applied back to the original checkout.
4. **Ollama repeatability** uses deterministic defaults: `think: false`, `temperature: 0`, `seed: 42`. Consensus candidates use stable seed offsets (`seed`, `seed + 1`, `seed + 2`, ...). Deterministic Ollama runs must keep streaming progress through the chat API; do not regress to non-streaming calls or hour-scale retry defaults that make agents appear stalled.
   When MAP has to start a missing local Ollama server, it must pass the configured `ollama.contextLength`, `ollama.numParallel`, and `ollama.maxLoadedModels` values as `OLLAMA_CONTEXT_LENGTH`, `OLLAMA_NUM_PARALLEL`, and `OLLAMA_MAX_LOADED_MODELS`. Defaults are 100000 context, 2 parallel requests, and 2 loaded models; CLI overrides (`--ollama-context-length`, `--ollama-num-parallel`, `--ollama-max-loaded-models`, plus `--ollama-host`) must remain wired through to Ollama-backed routers, agents, model sync, and security review.
5. **Adaptive timeout learning** treats `router.stepTimeoutMs` as a no-progress timeout, not a hard step total. Successful timeout backoffs are persisted in `.map/adaptive-timeouts.json` per agent. Timeout-only failures should retry with larger budgets but should not spawn recovery agents such as `bug-debugger`.
6. **Prompt evidence discipline** belongs in `src/utils/agent-conduct.ts`: do not fabricate citations, file paths, tool results, command output, test results, or verification evidence.

Do not remove these controls casually. If changing them, update README and tests in the same change.

Consensus diagnostics are part of the reporting contract. Results should show every provider/model used for consensus, each run number, status (`contributed`, `selected`, `valid`, `rejected`, or `failed`), and contribution percentage. Compact DAG graphs and deterministic `agent-network.svg` visuals must also surface consensus run count, method, run models, statuses, and contributions on the relevant step nodes. DAG visualization layouts are user-selectable with `--dag-layout auto|stage|metro|matrix|cluster`; auto should use stage swimlanes for small/medium HTML/SVG graphs and matrix lanes for large graphs. PDF output should default auto to a terse print-safe pipeline summary, suppress the detailed inline graph/steps table, and avoid embedding a duplicate full-size `agent-network.svg` figure. Router contribution means selected DAG-step overlap. Agent-output contribution means agreement/similarity with the selected output. File-output contribution means the verified patch selected for application.

When `--graph` is provided, MAP must write standalone agent-network graph images for every supported DAG layout (`auto`, `stage`, `metro`, `matrix`, `cluster`) as PNG files when Chrome/Chromium is available, with deterministic SVG fallbacks and `graphWarnings` if PNG rendering is unavailable. JSON/YAML output should include `graphArtifacts` and `graphArtifactManifestPath`.

Agent contribution diagnostics are also part of the reporting contract. Human-readable results must explain how each selected agent benefited the output, what downstream evidence or validation it contributed, and how to rerun the same prompt with `--disable-agent <agent>` for manual comparison. JSON/YAML results must expose the same machine-readable `agentContributions`, `agentComparisons`, `routerRationale`, `semanticJudge`, `judgePanel`, and `rerun` metadata. The network should question itself by flagging failed agents, failed handoffs, and missed spec-conformance checks as self-optimization candidates; disabled agents must be removed from the router's available-agent list and from adviser refreshes for that run. When `--compare-agents` is used, MAP should run baseline-vs-disabled-agent ablations, report keep/disable/review recommendations, and update `.map/agent-performance.json`. When `--judge-panel-models` is used, MAP should collect independent LLM votes on the DAG outcome; judge specs may be provider-qualified such as `ollama/gemma4:26b,claude/sonnet,codex/gpt-5`. If `--judge-panel-steer` is set, apply bounded feedback-driven reruns up to `--judge-panel-max-rounds`, and rejudge after each improvement until the panel accepts or the steering budget is exhausted. Judge panels should support adversarial roles via `--judge-panel-roles`, especially `evidence-skeptic`, `recency-auditor`, `contradiction-finder`, and `user-value-judge`.

## File-output consensus worktree flow

When `agentConsensus.fileOutputs.enabled` is true for a `files` agent:

1. Use the target working directory as the baseline. If it is exactly a git checkout root, require it to be clean. If it is an ignored output directory or non-git directory, create a temporary baseline git repository from its current contents.
2. Create candidate worktrees under `.map/worktrees/consensus/<step>/` for repo roots or under the temporary baseline repo for output directories.
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
