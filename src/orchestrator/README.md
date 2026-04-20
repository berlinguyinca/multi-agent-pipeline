# Orchestrator

DAG execution, recovery, and tool-aware step orchestration.

- `orchestrator.ts`: dependency scheduling, retries, recovery steps, and tool execution.
- Resource-aware scheduling and runtime graph metadata are owned here.
- Evidence-gate failures first use the inline remediation retry budget. If deterministic evidence checks still fail and a helper is available, the orchestrator appends a visible feedback loop (`<root>-evidence-feedback-N` plus `<root>-retry-N`), passes rejected claims/findings to the helper, and rewires downstream dependencies to the retry. Feedback helper output is not evidence-gated because it is remediation context; the retried source agent output is still gated before downstream use. These nodes use `edgeType: "feedback"` so renderers can show the evaluation/remediation loop instead of hiding it as a normal retry.
- Verbose reporter events should explain why a step failed, what recovery/helper/retry nodes were added, which models are being prepared for router self-recovery, and why MAP cannot recover automatically when the bounded helper/model path is exhausted.
