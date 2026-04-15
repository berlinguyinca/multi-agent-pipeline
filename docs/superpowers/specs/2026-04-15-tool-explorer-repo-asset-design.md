# Tool Explorer Repo Asset Design

## Overview

Add a repo-level documentation asset that explains what MAP is, what it can do, and how users can use MAP to explore MAP itself. This is not a runtime agent. It is a spec-backed content asset intended to support onboarding, self-discovery, and faster handoff into future implementation work.

## Motivation

The current repository explains MAP broadly in the main README, but it does not provide a focused, reusable asset whose sole job is to help users understand the tool from inside the tool. That leaves a gap for users who want answers to questions such as:

- what this tool is for
- which workflows or modes it supports
- when to use classic mode versus smart routing
- which prompts to use when exploring capabilities
- how to ask MAP to explain its own agents, tools, and pipeline

The requested solution is a repo asset rather than a runtime-visible agent. That keeps scope small, avoids changes to agent loading or routing, and still provides a durable artifact future sessions can extend.

## Goals

- Create a dedicated spec/doc asset for "tool exploration" and MAP self-explanation.
- Keep the change out of runtime agent registration and execution.
- Make the asset easy to find and easy to reuse in a new session.
- Give users concrete prompts they can use to explore MAP capabilities from within MAP.
- Clarify boundaries so the asset explains the system without pretending to be an executable agent role.

## Non-Goals

- Adding a new runtime agent under `agents/`.
- Changing agent loading, routing, or picker behavior.
- Adding new built-in commands or interactive UI surfaces in this pass.
- Rewriting the main README onboarding flow.

## Decision

The deliverable should be a documentation asset, not a runtime feature.

Recommended location:

- `docs/agents/tool-explorer.md`

This path keeps the asset close to the repo's agent-oriented documentation without making it part of the actual `agents/` registry. It is specific enough to find later and generic enough to evolve into richer docs if needed.

## Proposed Asset Shape

The asset should read like a user-facing "explainer agent" profile, but remain plain documentation.

Recommended sections:

### 1. Purpose

Explain that the asset helps users understand MAP and use MAP to inspect its own capabilities, workflows, and agent surfaces.

### 2. What MAP Can Do

Summarize the tool's main capabilities using language consistent with the current README:

- classic spec-first pipeline
- smart-routing v2 DAG execution
- headless and interactive TUI usage
- repo-defined agents
- spec review, QA, execution, and documentation flows

### 3. When To Use This Asset

Describe the best-fit scenarios:

- first-time orientation
- onboarding a teammate
- deciding which MAP mode to use
- discovering which agent or workflow matches a task
- asking MAP to explain the current repo setup

### 4. Example Exploration Prompts

Provide direct prompts users can ask MAP, for example:

- "What can this tool do?"
- "Explain the difference between classic mode and smart routing v2."
- "Which built-in agents exist in this repo and what are they for?"
- "How do I inspect available agents from the CLI?"
- "Show me how to use MAP to understand MAP."
- "Which workflow should I use for planning, coding, review, or docs?"

### 5. Suggested Prompt Template

Include a reusable prompt block that tells MAP to act as a tool guide, explain available capabilities, recommend the next step, and point to the relevant files or commands.

### 6. Boundaries

State explicitly that this asset:

- explains and guides
- does not register as an executable agent
- does not change runtime behavior
- should hand users to the right workflow, agent, command, or document

## Content Style

The doc should be:

- practical rather than promotional
- framed around user questions
- specific about commands and concepts already present in the repo
- concise enough to scan quickly

It should avoid:

- pretending unsupported features exist
- duplicating the entire README
- introducing runtime concepts that are not implemented

## Implementation Plan

This spec is intentionally small. The follow-up session should:

1. Create `docs/agents/tool-explorer.md`.
2. Write the explainer content using the shape above.
3. Reuse terminology already present in `README.md`, `src/agents/README.md`, and `src/cli/README.md`.
4. Keep the change doc-only unless a later request asks for stronger discoverability.

Optional follow-up, but not required in the first pass:

- add a short link from `README.md` to the new asset

## Risks and Tradeoffs

### Risk: the asset becomes redundant with the README

Mitigation: keep it narrowly focused on self-exploration, prompts, and guidance rather than general installation or full project documentation.

### Risk: the doc implies there is a real explainer agent

Mitigation: explicitly label it as a repo asset and state that it is not part of runtime agent registration.

### Risk: the asset goes stale as commands or workflows evolve

Mitigation: anchor descriptions to stable concepts first, and only mention commands and files that already exist in the repo.

## Recommendation

Implement a dedicated documentation asset at `docs/agents/tool-explorer.md` that behaves like a reusable "tool explorer" guide for users. Keep it out of the runtime agent system, focus it on MAP self-discovery, and use this spec as the handoff artifact for the next session.
