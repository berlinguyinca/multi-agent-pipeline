#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT_DIR/dist/cli.js"

if [[ ! -x "$CLI" ]]; then
  echo "Missing built CLI at $CLI" >&2
  echo "Run: scripts/build-map.sh" >&2
  exit 1
fi

args=(--headless)

if [[ -n "${CONFIG:-}" ]]; then
  args+=(--config "$CONFIG")
fi

if [[ -n "${OUTPUT_DIR:-}" ]]; then
  args+=(--output-dir "$OUTPUT_DIR")
fi

if [[ -n "${PERSONALITY:-}" ]]; then
  args+=(--personality "$PERSONALITY")
fi

exec "$CLI" "${args[@]}" "$@"
