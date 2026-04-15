# Spec File Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add classic-mode `--spec-file <path>` support so MAP can start from a prewritten spec, skip spec generation, and still run review, QA, and execution.

**Architecture:** Introduce a distinct `initialSpec` runtime input instead of overloading `prompt`, wire `--spec-file` through CLI and headless options, and branch the classic pipeline start so review begins from the loaded spec as iteration 1. Keep the first rollout classic-only by rejecting `--spec-file --v2`.

**Tech Stack:** TypeScript, Vitest, XState pipeline machine, Node.js filesystem I/O

---

### Task 1: Lock CLI parsing and validation with failing tests

**Files:**
- Modify: `tests/cli-args.test.ts`
- Modify: `tests/utils/prompt-validation.test.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Add CLI arg parsing tests for `--spec-file`**
- [ ] **Step 2: Add prompt validation tests for spec-file bypass and incompatible input combinations**
- [ ] **Step 3: Add CLI behavior tests for `--spec-file --v2` rejection and help text exposure**
- [ ] **Step 4: Run targeted tests and confirm they fail for missing spec-file support**

### Task 2: Implement CLI and validation support

**Files:**
- Modify: `src/cli-args.ts`
- Modify: `src/cli-runner.ts`
- Modify: `src/utils/prompt-validation.ts`
- Modify: `src/types/headless.ts`

- [ ] **Step 1: Add `--spec-file` to flag parsing**
- [ ] **Step 2: Read and validate the spec file in the CLI runner**
- [ ] **Step 3: Add input-source validation for prompt vs GitHub issue vs spec file**
- [ ] **Step 4: Reject `--spec-file --v2` with a clear error**
- [ ] **Step 5: Run targeted tests and confirm CLI support passes**

### Task 3: Add classic pipeline support for preloaded specs

**Files:**
- Modify: `src/types/pipeline.ts`
- Modify: `src/types/headless.ts`
- Modify: `src/pipeline/context.ts`
- Modify: `src/pipeline/machine.ts`
- Modify: `src/headless/runner.ts`

- [ ] **Step 1: Add `initialSpec` and `specFilePath` to runtime and pipeline types**
- [ ] **Step 2: Teach the pipeline start event/context to carry a preloaded spec**
- [ ] **Step 3: Skip spec generation when `initialSpec` exists and begin at review**
- [ ] **Step 4: Ensure headless results/reporting preserve the loaded spec and file path**
- [ ] **Step 5: Run targeted runner tests and confirm spec generation is skipped**

### Task 4: Add runner coverage for one-shot specs

**Files:**
- Modify: `tests/headless/runner.test.ts`
- Modify: any focused TUI or pipeline tests needed after the runtime change

- [ ] **Step 1: Add a headless test that loads a spec file as iteration 1**
- [ ] **Step 2: Assert review runs on the loaded spec and execution still proceeds**
- [ ] **Step 3: Assert spec-file runs report their source accurately**
- [ ] **Step 4: Add interactive-path tests only if startup args are wired there**

### Task 5: Document and verify the rollout

**Files:**
- Modify: `README.md`
- Review: `git diff`

- [ ] **Step 1: Add README examples for `--spec-file`**
- [ ] **Step 2: Run `npm test -- tests/cli-args.test.ts tests/utils/prompt-validation.test.ts tests/headless/runner.test.ts tests/cli.test.ts`**
- [ ] **Step 3: Run `npm test` if the repo-wide parse error is resolved; otherwise capture the blocker**
- [ ] **Step 4: Run `npm run typecheck` and `npm run build` if the existing parse blocker is resolved; otherwise capture the blocker**
- [ ] **Step 5: Summarize changed files, remaining risks, and any unrelated verification blockers**
