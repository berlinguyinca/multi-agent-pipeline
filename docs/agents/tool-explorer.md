# Tool Explorer Guide

Use this repo asset when you want MAP to explain MAP: what it does, which mode
fits a task, which repo-defined agents are available, and which files or
commands to inspect next.

This is documentation only. It is not a runtime agent, is not loaded from
`agents/`, and does not change routing or execution behavior.

## Purpose

The tool explorer helps users turn broad questions about MAP into concrete
navigation steps. It is meant to support first-time orientation, teammate
handoff, and self-discovery without adding another executable role to the
system.

Use this guide when the real task is orientation, mode selection, or handoff
rather than immediate execution.

## Capability Map

MAP orchestrates AI CLIs and local models through spec-first, test-driven
software delivery. It supports both the original guided pipeline and smart
routing over repo-defined agents.

| Area | What it does | Start here |
| --- | --- | --- |
| Smart routing v2 | Reads registered agents from `agents/`, creates a dependency-aware DAG, and runs independent steps in parallel where dependencies allow. This is the default. | `map --headless "prompt"` |
| Classic pipeline | Runs fixed stages for spec generation, spec review, spec QA, user feedback, TDD execution, code QA, and Markdown documentation. | `map --headless --classic "prompt"` |
| Interactive TUI | Lets a developer review specs, give feedback, approve execution, inspect DAG plans, and watch stage output. | `map` |
| Headless service | Returns structured JSON for unattended runs, scripts, CI, cron jobs, or PR review automation. | `map --headless "prompt"` |
| Repo-defined agents | Defines routable agents with `agent.yaml` and `prompt.md`: metadata, prompt, output type, tools, and adapter/model settings. | `map agent list` |
| Software-delivery flows | Documents common DAG compositions for features, bugs, builds, refactors, docs, QA, and release readiness. | `docs/agents/software-delivery-flows.md` |

The common theme is the same in both modes: invest in a clear spec and
verification path before spending implementation cycles.

## When To Use It

- A first-time user asks what MAP is or how to start.
- A teammate needs a quick handoff into modes, commands, agents, and repo files.
- A task could fit either classic mode or smart routing v2.
- A user wants to discover which agent or workflow matches planning, coding,
  review, docs, or release readiness.
- A session needs MAP to explain the current repository setup before changing
  code.

For direct implementation work, hand off to a real workflow or runtime agent
instead of treating this document as an agent.

## Mode Selection

| User intent | Best fit | Why |
| --- | --- | --- |
| Explore MAP manually and approve each step | Interactive TUI | Keeps a human in the loop for spec feedback and execution approval. |
| Run the default adaptive workflow | Smart routing v2 | Router builds a DAG from registered agents and dependency edges. |
| Run from an existing spec file | Smart routing v2 with `--spec-file` | Reuses the spec as the router task source and can include extra user instructions. |
| Run the fixed delivery pipeline from a prompt | Classic headless with `--classic` | Uses predictable spec -> review -> QA -> execute -> docs stages. |
| Inspect available agents | Agent CLI | Loads `agents/` and validates routing metadata without running a full pipeline. |
| Only understand the repo | Read-only exploration | Start with docs and CLI inspection before changing code. |

## Exploration Prompts

Ask MAP one of these prompts from the repo root:

```text
What can this tool do? Explain the main workflows and point me to the most
relevant files.
```

```text
Explain the difference between classic mode and smart routing v2. Recommend
which one fits my task and why.
```

```text
Which built-in agents exist in this repo and what are they for? Include their
expected output types and when to use them.
```

```text
How do I inspect available agents from the CLI? Show the commands and explain
what each command validates.
```

```text
Show me how to use MAP to understand MAP. Start with the README, then inspect
agent definitions, router docs, and software-delivery flows.
```

```text
Which workflow should I use for planning, coding, review, documentation, or
release readiness?
```

```text
Given this task, should I use default smart routing, opt into classic mode, or
only inspect the repo? Explain the tradeoff before recommending the next command.
```

## Reusable Prompt Template

Use this prompt when you want MAP to act as a tool guide for the current repo:

```text
Act as a MAP tool guide, not as a runtime agent.

Help me understand this repository and choose the right MAP workflow. Explain:

1. What MAP can do for my task.
2. Whether default smart routing, classic mode, headless mode, or the interactive TUI
   is the best fit.
3. Which repo-defined agents or software-delivery flows are relevant.
4. Which files or commands I should inspect next.
5. Any boundaries or risks before implementation.

Prefer concrete commands and file paths. Do not claim that a documentation asset
is an executable agent unless it is registered under agents/ and validated by the
CLI.
```

## Commands And Files

Core commands:

```bash
map --help
map
map --headless "Investigate how a concept is used in a domain"
map --headless --spec-file docs/spec.md
map --headless --classic "Run the fixed-stage pipeline for this task"
```

Agent inspection:

```bash
map agent list
map agent test implementation-coder
map agent create --adapter ollama --model gemma4:26b
```

Local checkout equivalents:

```bash
npm run dev -- --help
npm run dev -- --headless "Research the task, plan the steps, and assess readiness"
npm run dev -- agent list
```

Useful repo files:

- `README.md` explains installation, classic mode, smart routing v2, TUI usage,
  headless usage, agent commands, and architecture.
- `docs/agents/software-delivery-flows.md` describes common DAG compositions for
  software-delivery work.
- `src/agents/README.md` summarizes how agent definitions are loaded and
  normalized.
- `src/cli/README.md` identifies CLI command handlers and interactive helpers.
- `src/router/README.md` and `src/orchestrator/README.md` describe v2 routing
  and DAG execution internals.
- `agents/<name>/agent.yaml` and `agents/<name>/prompt.md` define each
  repo-backed runtime agent.

## Boundaries

This asset explains and guides. It should hand users to the right workflow,
agent, command, or document, then get out of the way.

This asset does not:

- register as an executable agent
- live under the runtime `agents/` registry
- change classic pipeline behavior
- change smart-routing v2 behavior
- add commands, screens, picker entries, or router behavior
- replace the README or full architecture documentation

If a future change needs a real tool-explorer agent, implement it separately
under `agents/`, validate it with `map agent test <name>`, and document how it
changes routing expectations.
