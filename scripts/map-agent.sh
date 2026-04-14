#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT_DIR/dist/cli.js"

if [[ ! -x "$CLI" ]]; then
  echo "Missing built CLI at $CLI" >&2
  echo "Run: scripts/build-map.sh" >&2
  exit 1
fi

exec "$CLI" agent "$@"
