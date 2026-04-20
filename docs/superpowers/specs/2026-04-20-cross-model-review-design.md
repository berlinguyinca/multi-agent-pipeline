# Cross-Model Review for Autonomous Software Delivery

## Summary

MAP should add a **cross-review DAG layer** that uses different models for different software-development responsibilities, has them critique each other, and uses hybrid judge arbitration to autonomously converge on a workable solution. The goal is not to make the user referee model disagreements. The goal is for MAP to route, review, judge, revise, verify, and report transparently while preserving its core autonomous behavior.

This feature covers both major MAP decision layers:

1. **Planning and release decisions** — DAG plans, spec QA, adviser replans, security-sensitive decisions, release-readiness review, and final outcome evaluation. Routing remains covered by router consensus in this implementation.
2. **File-changing software-delivery tasks** — TDD, implementation, build fixes, refactors, docs updates, and file-output consensus selection.

The selected design is **Approach B: Cross-review DAG layer**. It reuses existing MAP primitives such as router consensus, agent-output consensus, file-output worktree consensus, evidence feedback loops, judge panels, graph rendering, verbose reporting, and JSON/YAML result metadata.

## Goals

- Use heterogeneous models for complementary software-development tasks.
- Make model disagreement useful by converting it into structured critique and judge-steered remediation.
- Keep MAP autonomous: do not ask users to pick between model opinions.
- Prefer a best verified working solution over terminal failure when recovery paths remain.
- Preserve transparent diagnostics about which models proposed, reviewed, judged, revised, and verified each decision.
- Apply the feature to both planning/release decisions and file-changing delivery tasks.
- Keep runtime bounded with a default remediation budget.

## Non-goals

- Do not run a full multi-model committee for every trivial step by default.
- Do not hardcode specific model names such as `qwen3.6` or `gemma4`; defaults and examples may reference them, but model selection must stay configurable.
- Do not replace deterministic verification with model votes.
- Do not claim clean success when unresolved verification failures or risks remain.
- Do not introduce a separate orchestration universe when existing MAP consensus, judge, evidence, and graph systems can be reused.

## User-facing behavior

By default, MAP should enable cross-model review for high-impact gates. Users may disable or tune it through configuration and CLI flags. A typical run should behave as follows:

1. MAP receives a prompt, issue, or spec.
2. The router and planner choose an execution DAG.
3. High-impact planning decisions receive cross-model critique and hybrid judge synthesis.
4. File-changing agents produce tests, patches, docs, or fixes.
5. A different model reviews high-impact file outputs.
6. Judges decide whether to accept, revise with verification requested as remediation, or synthesize a combined approach.
7. MAP autonomously retries within the configured round budget.
8. Final results include the selected output plus a decision ledger explaining cross-review participation, remediation, requested verification, and residual risk.

Disagreement never asks the user to choose. The user sees transparent diagnostics after MAP has tried to resolve the issue internally.

## Architecture

The feature adds a cross-review layer around selected DAG steps:

```text
Propose -> Peer critique -> Hybrid judge arbitration -> Revise/verify -> Ledger/report
```

### Propose

A task-suited model creates the initial artifact. Examples:

- A planning model proposes a DAG.
- A coder model changes files.
- A TDD model writes tests.
- A docs model updates documentation.
- A release-readiness model assesses final risk.

### Peer critique

A different model reviews the artifact using a structured rubric. The rubric depends on the step type:

- Planning/release: missing agents, wrong dependencies, ignored constraints, excessive complexity. Routing remains protected by router consensus until cross-review routing is implemented.
- Architecture/API: compatibility, boundary clarity, migration risk, testability.
- Code/files: correctness, maintainability, spec conformance, test adequacy, build risk.
- Security: trust boundaries, data exposure, unsafe operations.
- Release: unresolved failures, missing evidence, unclear handoff.

### Hybrid judge arbitration

Hybrid arbitration means:

1. Prefer a separately configured judge panel when available.
2. If no separate judge panel is configured, use participating proposer/reviewer models as judges.
3. Apply deterministic tie-break policy when model votes do not converge.

Judges should not merely vote yes/no. They should choose an action:

- Accept as-is.
- Revise using specific reviewer findings.
- Request verification as remediation under a revise or combine decision.
- Combine parts of competing proposals.
- Request a focused retry from the original proposer.
- Escalate only when MAP lacks authority or the action would be destructive.

### Revise and verify

MAP applies judge feedback autonomously. For file-changing work, retries should use isolated worktrees when file-output consensus is enabled and should rerun configured verification commands in the selected workspace. For non-file work, retries should preserve the critique and judge decision as context.

Verification remains factual and deterministic where possible:

- typecheck
- tests
- lint
- build
- evidence gates
- security review
- release-readiness checks

### Loop budget

The default remediation budget is **2 judge-steered rounds**. The budget should be configurable, with a reasonable upper bound such as 5 rounds to prevent runaway local-model loops.

When the budget is exhausted, MAP should return the best available candidate with visible unresolved risks and verification status. It should not silently mark the run as cleanly successful.

## Components

### `CrossReviewConfig`

A new config section should define behavior such as:

```yaml
crossReview:
  enabled: true
  defaultHighImpactOnly: true
  maxRounds: 2
  maxRoundsUpperBound: 5
  autonomy: nonblocking
  judge:
    preferSeparatePanel: true
    models: []
  gates:
    planning: true
    routing: false
    architecture: false
    apiContract: false
    fileOutputs: true
    security: true
    releaseReadiness: true
    verificationFailure: false
  roleModels:
    implementation:
      proposer: ollama/qwen3.6
      reviewer: ollama/gemma4
    planning:
      proposer: ollama/gemma4
      reviewer: ollama/qwen3.6
```

Exact schema names can change during implementation, but the design intent is stable:

- model assignments are configurable;
- the feature is enabled by default for high-impact gates;
- disagreement is nonblocking and feeds remediation;
- judge arbitration prefers a separate panel but can fall back.

### Gate planner

The gate planner decides whether a DAG step needs cross-review. Inputs should include:

- step agent name;
- step output type;
- role contract or agent metadata;
- run flags;
- config gates;
- verification status;
- security/evidence criticality;
- whether the step changes files.

Default runtime-enforced high-impact gates:

- planning/spec outputs and adviser replans;
- security-sensitive steps;
- file-changing agents;
- release-readiness review.

Reserved/default-off gates remain in the config surface for future expansion: routing, architecture/API-contract, and verification-failure recovery. Routing remains protected by router consensus in this implementation.

### Review loop executor

The executor inserts or runs helper nodes such as:

- `*-peer-review-*`
- `*-judge-arbitration-*`
- `*-revision-*`
- `*-retry-*`
- verification or repair-feedback nodes as needed

The graph should preserve `review`, `judge`, `feedback`, `retry`, and `recovery` edge types so users can see the loop rather than only the final replacement step.

### Decision ledger

Each cross-reviewed decision should record:

- original step ID;
- gate reason;
- proposer provider/model/agent;
- reviewer provider/model/agent;
- judge provider/model/role;
- critique summary;
- judge decision;
- requested remediation;
- revision step IDs;
- verification commands and outcomes;
- round count;
- selected candidate;
- residual risks;
- whether budget was exhausted.

Human-readable outputs should summarize this ledger. JSON/YAML outputs should expose it as machine-readable metadata, likely under a new `crossReview` field while linking to existing `judgePanel`, `agentContributions`, `routerRationale`, and `rerun` metadata.

## Data flow

For a high-impact step:

1. Step output is captured.
2. Gate planner marks it for cross-review.
3. Peer reviewer receives the output, original user goal, relevant upstream context, role rubric, and verification results if available.
4. Reviewer emits structured findings with severity, evidence, and suggested remediation.
5. Hybrid judges receive the original output, critique, run constraints, and verification context.
6. Judges emit an action decision and concise rationale.
7. MAP creates retry/revision/verification work according to the judge decision.
8. The loop repeats until accepted, verified enough for the task, or the round budget is exhausted.
9. Result builder and graph renderer publish the decision ledger.

## Error handling

- **Model disagreement:** create judge arbitration and remediation; do not fail solely because models disagree.
- **Reviewer-only preference/style issue:** record as advisory unless the judge chooses a specific revision.
- **Verification failure:** create repair feedback and retry within budget.
- **Judge panel unavailable:** fall back to participating models and deterministic tie-break policy.
- **Participating model unavailable:** reuse existing adapter/Ollama preparation and fallback behavior where possible; record degraded diagnostics.
- **Round budget exhausted:** return best effort with unresolved risks and verification status.
- **Destructive or unauthorized action required:** escalate to the user because MAP lacks safe authority.

## Autonomy rules

MAP is an autonomous execution system. Cross-model review must reinforce that identity:

- Do not ask the user which model is right.
- Do not stop when a reviewer disagrees if a remediation path exists.
- Do not treat model votes as stronger than tests, typecheck, build, evidence, or security findings.
- Do not loop forever.
- Do report exactly what was tried, what changed, what passed, and what remains risky.

## Reporting and diagnostics

Reports should include:

- cross-review status for each gated step;
- proposer/reviewer/judge model identities;
- reviewer findings and judge decisions;
- number of rounds used;
- remediation applied;
- verification evidence;
- unresolved risks;
- rerun guidance for disabling or tuning cross-review.

Graph artifacts should show review and judge nodes or compact annotations for cross-reviewed nodes. Compact output should remain readable and should not overwhelm users with raw deliberation logs.

## Testing strategy

Implementation should include tests for:

- config/schema parsing and defaults;
- CLI override plumbing;
- gate-selection logic;
- orchestrator insertion of review, judge, feedback, retry, and verification nodes;
- nonblocking disagreement behavior;
- judge fallback behavior when separate judges are unavailable;
- budget exhaustion reporting;
- file-changing retry behavior with existing file-output consensus/worktree flow;
- result-builder JSON/YAML metadata;
- Markdown/HTML compact summaries;
- graph artifacts preserving review/judge/retry edges;
- regression where disagreement triggers remediation rather than terminal failure.

Standard completion verification remains:

- `npm run build`
- relevant unit tests
- `npm run test:core` when implementation touches routing/orchestration/reporting
- documentation updates in `README.md` and `AGENTS.md` for any routing, consensus, execution-flow, or reporting changes

## Open implementation notes

- The implementation plan should decide whether cross-review is represented as explicit DAG nodes, internal orchestration events, or a hybrid. The design prefers visible DAG nodes/edges for transparency.
- The exact config schema should be kept small in V1 and expanded only when needed.
- Existing judge-panel steering should be reused before adding new judge machinery.
- Existing evidence feedback and file-output consensus loops should remain the source of truth for fact-critical and file-changing remediation.
- Model-specific defaults should be examples, not hardcoded requirements.
