# Security

Security gate logic for generated output.

- Static pattern scanning and LLM review live here.
- Gated outputs are reviewed before being accepted downstream.
- Failed gates are fed back into the producing agent for bounded remediation before the step is rejected.
