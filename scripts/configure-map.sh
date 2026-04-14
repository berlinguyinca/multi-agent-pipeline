#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Configure MAP without reinstalling.

Usage:
  scripts/configure-map.sh

Environment:
  MAP_CONFIG_PATH       Config file to create, default ~/.map/pipeline.yaml
  MAP_FORCE_CONFIG=1    Overwrite existing config
  MAP_ASSUME_DEFAULTS=1 Use detected/default settings without prompts
  MAP_OLLAMA_MODEL      Default Ollama model, default gemma4:26b
  MAP_OLLAMA_HOST       Ollama host, default http://localhost:11434
  MAP_OUTPUT_DIR        Default generated project output directory
  MAP_DEFAULT_MODEL     Optional model for non-Ollama adapters
  MAP_DEFAULT_AGENT_ADAPTER
                        Default adapter for software-delivery agents
  MAP_SKIP_ONBOARDING=1 Skip config generation
EOF
  exit 0
fi

exec "$ROOT_DIR/install.sh" --configure-only
