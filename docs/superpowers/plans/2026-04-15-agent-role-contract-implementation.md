# Agent Role Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured role contracts to repo-backed agents, synthesize stronger runtime prompts from them, and migrate all first-party agents to explicit role behavior.

**Architecture:** Extend `AgentDefinition` with an optional `contract` model, validate it at load time, and synthesize a normalized instruction block that is prepended to each agent prompt. Migrate the shipped agents in one pass so the fleet becomes consistently explicit, and lock the behavior with loader, type, router, and bundle tests.

**Tech Stack:** TypeScript, Vitest, YAML-backed agent definitions, markdown prompts

---

### Task 1: Lock the schema behavior with failing tests

**Files:**
- Modify: `tests/types/agent-definition.test.ts`
- Modify: `tests/agents/loader.test.ts`
- Modify: `tests/agents/software-delivery-agents.test.ts`
- Create: `tests/agents/fixtures/invalid-contract-agent/agent.yaml`
- Create: `tests/agents/fixtures/invalid-contract-agent/prompt.md`

- [ ] **Step 1: Add type-level validation tests for valid and invalid contracts**
- [ ] **Step 2: Add loader tests that expect contract parsing and synthesized prompt content**
- [ ] **Step 3: Add a loader failure test for invalid contract shape**
- [ ] **Step 4: Add a bundle test that requires first-party agents to define contracts**
- [ ] **Step 5: Run targeted agent tests and confirm they fail for missing contract support**

### Task 2: Implement the contract schema and prompt synthesis

**Files:**
- Modify: `src/types/agent-definition.ts`
- Modify: `src/agents/loader.ts`
- Create: `src/agents/contract-prompt.ts`
- Modify: `src/agents/README.md`

- [ ] **Step 1: Add `AgentContract` types and validation helpers**
- [ ] **Step 2: Parse `contract` from YAML in the loader**
- [ ] **Step 3: Generate a normalized contract instruction block**
- [ ] **Step 4: Prepend the generated block to `prompt.md` while preserving backward compatibility**
- [ ] **Step 5: Run targeted tests and confirm the new schema and prompt behavior pass**

### Task 3: Migrate fixtures and first-party agents

**Files:**
- Modify: `tests/agents/fixtures/valid-agent/agent.yaml`
- Modify: `tests/agents/fixtures/minimal-agent/agent.yaml`
- Modify: every first-party `agents/*/agent.yaml`
- Modify: every first-party `agents/*/prompt.md`

- [ ] **Step 1: Add representative contracts to fixture agents**
- [ ] **Step 2: Add explicit contracts to every first-party agent YAML**
- [ ] **Step 3: Tighten each first-party prompt so it carries nuance instead of boilerplate**
- [ ] **Step 4: Run the bundle tests and fix any incomplete migrations**

### Task 4: Propagate the richer role signals through routing and verification

**Files:**
- Modify: `src/router/prompt-builder.ts`
- Modify: `tests/router/prompt-builder.test.ts`

- [ ] **Step 1: Include contract-derived signals in router-visible agent descriptions**
- [ ] **Step 2: Add prompt-builder tests for capabilities or mission text exposure**
- [ ] **Step 3: Run router tests and verify the new routing context is present**

### Task 5: Full verification and cleanup

**Files:**
- Review: `git diff`

- [ ] **Step 1: Run `npm test`**
- [ ] **Step 2: Run `npm run typecheck`**
- [ ] **Step 3: Run `npm run build`**
- [ ] **Step 4: Review the diff for duplicated prompt boilerplate or migration misses**
- [ ] **Step 5: Summarize changed files, simplifications, and residual risks**
