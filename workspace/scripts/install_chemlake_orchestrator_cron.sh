#!/usr/bin/env bash
# Install/update the Hive cron entry that keeps the Chemlake orchestrator alive.
set -euo pipefail

ROOT="${CHEMLAKE_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SCHEDULE="${CHEMLAKE_ORCHESTRATOR_CRON_SCHEDULE:-*/5 * * * *}"
LOG_DIR="${CHEMLAKE_ORCHESTRATOR_CRON_LOG_DIR:-${ROOT}/logs}"
ENV_FILE="${CHEMLAKE_ENV_FILE:-${ROOT}/slurm/env.sh}"
MARKER_START="# CHEMLAKE_ORCHESTRATOR_CRON_START"
MARKER_END="# CHEMLAKE_ORCHESTRATOR_CRON_END"
mkdir -p "$LOG_DIR"

if ! command -v crontab >/dev/null 2>&1; then
  echo "crontab is not available on this host" >&2
  exit 2
fi

ENTRY="${SCHEDULE} cd ${ROOT} && CHEMLAKE_REPO_ROOT=${ROOT} CHEMLAKE_ENV_FILE=${ENV_FILE} ${ROOT}/scripts/ensure_chemlake_orchestrator.sh >> ${LOG_DIR}/chemlake-orchestrator-cron.log 2>&1"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

(crontab -l 2>/dev/null || true) | awk -v start="$MARKER_START" -v end="$MARKER_END" '
  $0 == start { skip=1; next }
  $0 == end { skip=0; next }
  skip != 1 { print }
' > "$TMP"
{
  printf '%s\n' "$MARKER_START"
  printf '%s\n' "$ENTRY"
  printf '%s\n' "$MARKER_END"
} >> "$TMP"
crontab "$TMP"
printf 'installed Chemlake orchestrator cron entry:\n%s\n' "$ENTRY"
