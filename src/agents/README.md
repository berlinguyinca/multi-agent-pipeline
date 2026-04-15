# Agents

Loads repo-backed agent definitions and applies runtime overrides.

- `loader.ts`: parses `agent.yaml` and prompt files.
- `registry.ts`: discovers agents and merges overrides.
- `contract-prompt.ts`: renders structured role contract metadata into normalized runtime instructions and router-facing summaries.

Agent definitions may include an optional `contract` block in `agent.yaml` for explicit role behavior such as mission, capabilities, non-goals, escalation rules, verification evidence, and handoff expectations.
