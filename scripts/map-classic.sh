#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT_DIR/dist/cli.js"

if [[ ! -x "$CLI" ]]; then
  echo "Missing built CLI at $CLI" >&2
  echo "Run: scripts/build-map.sh" >&2
  exit 1
fi

args=(--headless --classic)

if [[ -n "${CONFIG:-}" ]]; then
  args+=(--config "$CONFIG")
fi

if [[ -n "${OUTPUT_DIR:-}" ]]; then
  args+=(--output-dir "$OUTPUT_DIR")
fi

if [[ -n "${TOTAL_TIMEOUT:-}" ]]; then
  args+=(--total-timeout "$TOTAL_TIMEOUT")
fi

if [[ -n "${INACTIVITY_TIMEOUT:-}" ]]; then
  args+=(--inactivity-timeout "$INACTIVITY_TIMEOUT")
fi

if [[ -n "${POLL_INTERVAL:-}" ]]; then
  args+=(--poll-interval "$POLL_INTERVAL")
fi

if [[ -n "${GITHUB_ISSUE:-}" ]]; then
  args+=(--github-issue "$GITHUB_ISSUE")
fi

if [[ -n "${PERSONALITY:-}" ]]; then
  args+=(--personality "$PERSONALITY")
fi

exec "$CLI" "${args[@]}" "$@"
