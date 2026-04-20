# Software Delivery Agent Flows

This repository supports agent definitions under `agents/<name>/` and router-produced DAG plans. The agents in this bundle are intended to be composed for common software delivery work.

All software-delivery agents added in PR #1 use `adapter: ollama` and `model: gemma4:26b` by default. When one of these agents runs, MAP prepares Ollama at runtime: it starts `ollama serve` if needed and runs `ollama pull gemma4:26b` to install or refresh the local tag.

## Agent Bundle

| Agent | Output | Primary use |
| --- | --- | --- |
| `software-delivery` | `files` | Complete spec -> QA -> TDD -> implementation -> code QA lifecycle. |
| `spec-writer` | `answer` | Convert rough requests into implementation-ready specs. |
| `spec-qa-reviewer` | `answer` | Review specs for ambiguity, test gaps, and implementation risk. |
| `adviser` | `answer` | Recommend the best agent launch workflow from reviewed/QA-approved specs, including custom-agent and registry-refresh guidance. |
| `tdd-engineer` | `files` | Create test-first plans and failing tests. |
| `implementation-coder` | `files` | Implement minimal code changes that satisfy tests. |
| `code-qa-analyst` | `answer` | Review code against specs, tests, and maintainability expectations. |
| `legal-license-advisor` | `answer` | Recommend compatible license options from utilized languages, libraries, package manifests, dependency license evidence, and existing license files. |
| `grammar-spelling-specialist` | `answer` | Automatically polish generated prose for grammar, spelling, punctuation, readability, and terminal-artifact cleanup. |
| `github-review-merge-specialist` | `answer` | Review GitHub pull requests and merge them when checks and findings are clean. |
| `bug-debugger` | `answer` | Reproduce defects and isolate root cause. |
| `build-fixer` | `files` | Fix build, typecheck, lint, and toolchain failures. |
| `test-stabilizer` | `files` | Improve flaky, brittle, or missing tests. |
| `refactor-cleaner` | `files` | Simplify code without behavior changes. |
| `docs-maintainer` | `files` | Update post-build README, license coverage, and Markdown documentation after implementation. |
| `release-readiness-reviewer` | `answer` | Assess final readiness and residual risk. |

## Router Selection Notes

The router sees each agent's `description`, `handles`, and output type. Keep step tasks specific and dependency edges explicit:

- Use `answer` agents for analysis, review, and decision points.
- Human-facing text outputs (`answer` or `presentation`) automatically route through `grammar-spelling-specialist` before downstream agents consume them; code/file outputs and machine-readable JSON are left untouched.
- For coding workflows with a reviewed and QA-approved spec, route through `adviser` before execution agents so launch order, parallel work, custom agents, and registry refresh needs are explicit. If `adviser` returns `kind: "adviser-workflow"` JSON, MAP refreshes the agent registry when requested and replaces pending downstream DAG steps with the advised workflow.
- `code-qa-analyst` must finish implementation reviews with a structured `accept|revise|reject` verdict. `revise` and `reject` automatically schedule the upstream file-output developer agent to repair the issue, rerun code QA, and rewire downstream steps to the QA retry until the configured QA iteration budget is exhausted.
- For completed user-facing software builds, schedule `legal-license-advisor` after implementation QA and before `docs-maintainer` so license recommendations are evidence-backed before README/license documentation is finalized.
- Use `files` agents when the step is expected to create or modify files.
- Put QA/review agents after implementation or docs steps when their output should gate downstream work.
- Use `software-delivery` as a single-agent fallback for tasks that do not need explicit DAG decomposition.

## Feature Delivery

Use this when a request needs a new feature or meaningful behavior change.

```json
{
  "plan": [
    { "id": "step-1", "agent": "spec-writer", "task": "Create an implementation-ready specification", "dependsOn": [] },
    { "id": "step-2", "agent": "spec-qa-reviewer", "task": "Review the specification for ambiguity, missing tests, and risk", "dependsOn": ["step-1"] },
    { "id": "step-3", "agent": "adviser", "task": "Recommend the best launch workflow from the reviewed and QA-approved spec", "dependsOn": ["step-2"] },
    { "id": "step-4", "agent": "tdd-engineer", "task": "Write failing tests from the reviewed specification", "dependsOn": ["step-3"] },
    { "id": "step-5", "agent": "implementation-coder", "task": "Implement the smallest code change that satisfies the tests", "dependsOn": ["step-4"] },
    { "id": "step-6", "agent": "code-qa-analyst", "task": "Review the code against the reviewed specification and tests", "dependsOn": ["step-5"] },
    { "id": "step-7", "agent": "legal-license-advisor", "task": "Recommend compatible license options from language and dependency evidence", "dependsOn": ["step-6"] },
    { "id": "step-8", "agent": "docs-maintainer", "task": "Update README, license coverage, and Markdown documentation for the completed behavior", "dependsOn": ["step-7"] },
    { "id": "step-9", "agent": "stabilization-reviewer", "task": "Audit capability claims, specs, docs, and integration boundaries", "dependsOn": ["step-8"] },
    { "id": "step-10", "agent": "release-readiness-reviewer", "task": "Assess final readiness and residual risk", "dependsOn": ["step-9"] },
    { "id": "step-11", "agent": "github-review-merge-specialist", "task": "Perform the final GitHub PR review and merge the approved changes", "dependsOn": ["step-10"] }
  ]
}
```

## Bug Fix

Use this when the request starts from broken behavior, logs, a stack trace, or a failing test.

```json
{
  "plan": [
    { "id": "step-1", "agent": "bug-debugger", "task": "Reproduce and isolate the defect", "dependsOn": [] },
    { "id": "step-2", "agent": "tdd-engineer", "task": "Add a regression test for the defect", "dependsOn": ["step-1"] },
    { "id": "step-3", "agent": "implementation-coder", "task": "Implement the minimal fix", "dependsOn": ["step-2"] },
    { "id": "step-4", "agent": "code-qa-analyst", "task": "Verify the fix and test coverage", "dependsOn": ["step-3"] }
  ]
}
```

## Build Failure

Use this when the task is dominated by typecheck, lint, compile, or package script failures.

```json
{
  "plan": [
    { "id": "step-1", "agent": "build-fixer", "task": "Fix the failing build or typecheck command", "dependsOn": [] },
    { "id": "step-2", "agent": "test-stabilizer", "task": "Repair any brittle tests exposed by the build fix", "dependsOn": ["step-1"] },
    { "id": "step-3", "agent": "release-readiness-reviewer", "task": "Confirm verification evidence and residual risk", "dependsOn": ["step-2"] }
  ]
}
```

## Refactor

Use this when the goal is simplification without intended behavior change.

```json
{
  "plan": [
    { "id": "step-1", "agent": "spec-qa-reviewer", "task": "Define behavior boundaries and test expectations for the cleanup", "dependsOn": [] },
    { "id": "step-2", "agent": "refactor-cleaner", "task": "Simplify the code while preserving behavior", "dependsOn": ["step-1"] },
    { "id": "step-3", "agent": "code-qa-analyst", "task": "Review for behavior drift and maintainability risk", "dependsOn": ["step-2"] },
    { "id": "step-4", "agent": "test-stabilizer", "task": "Update or stabilize tests only where coverage remains equivalent or stronger", "dependsOn": ["step-3"] }
  ]
}
```
