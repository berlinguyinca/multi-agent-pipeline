# Software Delivery Agent Flows

This repository supports agent definitions under `agents/<name>/` and router-produced DAG plans. The agents in this bundle are intended to be composed for common software delivery work.

## Feature Delivery

Use this when a request needs a new feature or meaningful behavior change.

```json
{
  "plan": [
    { "id": "step-1", "agent": "spec-writer", "task": "Create an implementation-ready specification", "dependsOn": [] },
    { "id": "step-2", "agent": "spec-qa-reviewer", "task": "Review the specification for ambiguity, missing tests, and risk", "dependsOn": ["step-1"] },
    { "id": "step-3", "agent": "tdd-engineer", "task": "Write failing tests from the reviewed specification", "dependsOn": ["step-2"] },
    { "id": "step-4", "agent": "implementation-coder", "task": "Implement the smallest code change that satisfies the tests", "dependsOn": ["step-3"] },
    { "id": "step-5", "agent": "code-qa-analyst", "task": "Review the code against the reviewed specification and tests", "dependsOn": ["step-4"] },
    { "id": "step-6", "agent": "docs-maintainer", "task": "Update Markdown documentation for the completed behavior", "dependsOn": ["step-5"] },
    { "id": "step-7", "agent": "release-readiness-reviewer", "task": "Assess final readiness and residual risk", "dependsOn": ["step-6"] }
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
