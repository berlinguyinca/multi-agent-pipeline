# Agent Role Contract Design

## Overview

Strengthen repo-backed agent definitions so each role is explicit about what it can do, what it must not do, how it should work, when it should escalate, and what evidence it must produce before handoff. The goal is to move role behavior out of sparse freeform prompts and into a structured contract that the runtime can validate, inspect, and turn into stronger execution prompts.

## Motivation

The current agent format is too thin for a high-competence multi-agent system. Most agents declare only a short description, a prompt, a pipeline, and a natural-language `handles` string. That leaves critical behavior implicit:

- capability boundaries are not machine-readable
- escalation and refusal conditions vary by prompt quality
- verification expectations are not explicit enough to enforce
- handoff shape between roles is underspecified
- routing can only use coarse descriptive text instead of explicit role signals

This makes the fleet harder to trust, harder to extend, and harder to route accurately. A stronger role contract should improve both human maintainability and runtime behavior.

## Goals

- Add a structured agent contract that makes role expectations explicit and machine-readable.
- Preserve the existing `agents/<name>/agent.yaml` plus `prompt.md` layout.
- Keep current agents loadable during migration.
- Generate richer runtime instructions from structured role metadata.
- Make every shipped role more explicit about capabilities, decision boundaries, evidence standards, and handoff expectations.

## Non-Goals

- Replacing the existing pipeline model with a different orchestration architecture.
- Building a new UI for editing agent definitions.
- Adding dynamic policy learning or agent self-modification.
- Changing adapter execution behavior beyond what is required to load and render the new contract.

## Current State

Today an agent definition includes:

- identity fields such as `name`, `description`, `adapter`, and `model`
- a main prompt loaded from `prompt.md`
- an ordered `pipeline`
- a freeform `handles` description
- tool declarations and output type

In practice, most role behavior lives in a compact `prompt.md` with sections like mission, responsibilities, and output. That prose is useful, but too incomplete and inconsistent to serve as the main contract for routing and execution.

## Proposed Design

### 1. Structured `contract` section in `agent.yaml`

Each agent definition gains an optional `contract` object. This object becomes the canonical place for explicit role behavior.

Example shape:

```yaml
contract:
  mission: "Produce implementation-ready specifications from rough software requests."
  capabilities:
    - "Clarify goals, constraints, and non-goals."
    - "Define acceptance criteria that can be tested."
    - "Identify affected interfaces and dependencies."
  nonGoals:
    - "Do not implement code changes."
    - "Do not invent requirements that materially change scope."
  inputs:
    required:
      - "User request"
    optional:
      - "Existing specs"
      - "Relevant code context"
  process:
    - "Restate the task in concrete terms."
    - "Separate current behavior from target behavior."
    - "Make assumptions explicit and minimize them."
    - "Produce testable acceptance criteria."
  decisionRules:
    - "Prefer narrower scope when multiple plausible interpretations exist."
    - "Prefer repository conventions over novel abstractions."
  escalationTriggers:
    - "Conflicting requirements"
    - "Missing information that would change architecture or scope"
  verification:
    requiredEvidence:
      - "Acceptance criteria map to observable behavior"
      - "Open assumptions are called out explicitly"
  handoff:
    deliverable: "Markdown specification"
    includes:
      - "Goal"
      - "Acceptance criteria"
      - "Constraints"
      - "Verification notes"
```

### 2. Runtime prompt synthesis

The runtime should synthesize a normalized instruction block from `contract` and prepend it to the agent's `prompt.md`. The synthesized block should be deterministic and ordered so every role is expressed with the same scaffolding:

1. Role identity and mission
2. Primary capabilities
3. Explicit non-goals
4. Expected inputs and minimum context checks
5. Ordered process expectations
6. Decision and tradeoff rules
7. Escalation triggers
8. Verification and evidence requirements
9. Handoff contract

This preserves the value of rich prose prompts while ensuring every role has a consistent behavioral spine.

### 3. Prompt division of responsibility

The new contract should carry the explicit operational rules. `prompt.md` should remain responsible for:

- role-specific judgment and nuance
- tone and emphasis
- examples of good and bad behavior
- domain-specific heuristics that are awkward to encode structurally

This keeps the system from duplicating the same instructions in both YAML and prose.

### 4. Backward compatibility

`contract` should be optional during rollout. Existing agent definitions without the field continue to load. For agents without `contract`, runtime behavior remains unchanged. Once all first-party agents are migrated, tests can enforce that shipped repo agents include the contract.

## Contract Schema

The initial schema should be strict enough to be useful and loose enough to migrate incrementally.

Recommended TypeScript shape:

```ts
interface AgentContract {
  mission: string;
  capabilities: string[];
  nonGoals?: string[];
  inputs?: {
    required?: string[];
    optional?: string[];
  };
  process?: string[];
  decisionRules?: string[];
  escalationTriggers?: string[];
  verification?: {
    requiredEvidence?: string[];
    forbiddenClaims?: string[];
  };
  handoff?: {
    deliverable: string;
    includes?: string[];
  };
}
```

Validation rules:

- `mission` is required and non-empty
- `capabilities` is required and must contain at least one entry
- all list fields must contain non-empty strings
- nested objects are optional, but if present must match shape
- `handoff.deliverable` is required when `handoff` exists

This version intentionally avoids premature complexity such as weights, scoring rubrics, or role inheritance.

## Runtime Changes

### Loader behavior

`src/agents/loader.ts` should:

- parse `contract` from `agent.yaml`
- validate and attach it to `AgentDefinition`
- synthesize the normalized instruction block
- prepend that block to the existing `prompt.md` content

The prompt synthesis should be centralized in a helper so tests can assert exact prompt output without depending on file I/O.

### Type system updates

`src/types/agent-definition.ts` should:

- define the new `AgentContract` types
- add `contract?: AgentContract` to `AgentDefinition`
- extend validation to cover the contract shape

### Registry behavior

`src/agents/registry.ts` likely does not need major changes beyond preserving the richer agent object through load and override flows. Overrides should not silently discard `contract`.

## Role Upgrade Strategy

All first-party agents under `agents/` should be migrated in the same pass so the fleet becomes consistently explicit. The stronger contracts should differ by role category.

### Delivery and implementation roles

Examples: `software-delivery`, `coder`, `implementation-coder`, `tdd-engineer`

These roles should be explicit about:

- sequencing discipline
- smallest-coherent-change bias
- test-first expectations where applicable
- recovery loops for failing builds or tests
- proof required before claiming completion

### Review and gatekeeping roles

Examples: `code-qa-analyst`, `spec-qa-reviewer`, `release-readiness-reviewer`, `result-judge`

These roles should be explicit about:

- severity framing
- rejection thresholds
- what counts as sufficient evidence
- residual risk reporting
- refusal to approve on optimism or inference alone

### Specialist roles

Examples: `security-advisor`, `dba-agent`, `github-review-merge-specialist`, `test-stabilizer`

These roles should be explicit about:

- role-specific risk models
- dangerous shortcuts they must reject
- operational and production safety guardrails
- when specialist review blocks forward motion

### Research and design roles

Examples: `researcher`, `spec-writer`, `ux-design-agent`, `web-design-agent`, `presentation-designer`, `visualization-builder`

These roles should be explicit about:

- uncertainty handling
- alternatives and tradeoff presentation
- source quality expectations where applicable
- artifact shape and communication standards

## File Changes

Expected files:

- `src/types/agent-definition.ts`
- `src/agents/loader.ts`
- `tests/agents/loader.test.ts`
- `tests/agents/registry.test.ts`
- any test fixtures under `tests/agents/fixtures/`
- every first-party `agents/*/agent.yaml`
- every first-party `agents/*/prompt.md`

Optional if helpful:

- `src/agents/README.md` for documenting the new contract format
- a dedicated helper such as `src/agents/contract-prompt.ts` if prompt synthesis should be isolated

## Migration Plan

1. Add the contract types and validation logic.
2. Add prompt synthesis from contract metadata.
3. Update loader tests and fixtures for valid and invalid contract shapes.
4. Migrate all first-party agents to include a contract.
5. Tighten tests so shipped agents must define contracts.
6. Revise prompts to remove duplicated boilerplate and preserve role nuance.

## Verification Plan

Implementation will be considered correct when:

- contract-bearing agents load successfully
- invalid contract shapes fail validation
- synthesized prompts include the normalized contract sections
- existing agents without contracts still load during the migration window
- the full test suite for agent loading and prompt behavior passes
- a repository-level assertion verifies first-party agents have explicit contracts once migration is complete

## Risks and Tradeoffs

### Risk: duplicated instructions across YAML and prompt prose

Mitigation: keep the structured contract focused on explicit operational behavior and keep `prompt.md` focused on nuance and examples.

### Risk: overly rigid roles that become less adaptable

Mitigation: encode boundaries and evidence requirements, not exhaustive scripts. Preserve open-text prompt guidance for judgment-heavy work.

### Risk: partial migration leaves role quality uneven

Mitigation: migrate all first-party agents in one pass and then add a test that prevents regressions.

### Risk: prompt size increases too much

Mitigation: keep synthesized sections concise and normalize wording through a single helper.

## Open Questions Resolved

- Should this be prompt-only? No. Structured metadata is required so the runtime can inspect behavior rather than rely on prose.
- Should behavior live in a separate file? Not initially. Keeping the contract inside `agent.yaml` preserves the current layout and minimizes loader complexity.
- Should rollout be backward-compatible? Yes. Optional contract support during migration reduces risk and keeps current agents loadable until the fleet is upgraded.

## Recommendation

Implement the structured `contract` model inside `agent.yaml`, synthesize a normalized runtime instruction block from it, and migrate all first-party agents in one pass. This gives the repository a stronger, explicit agent fleet without introducing a new directory structure or a second role-definition file format.
