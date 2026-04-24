#!/usr/bin/env bash
# Cron-safe Hive supervisor for the Chemlake orchestration service.
# It maintains exactly one pending/running orchestrator Slurm job and submits one
# only when none is visible in squeue.
set -euo pipefail

ROOT="${CHEMLAKE_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"

# Cron usually has a tiny PATH; include common Slurm locations while allowing
# operators to override for Hive module layouts.
export PATH="${CHEMLAKE_CRON_PATH:-/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/slurm/bin:/usr/local/slurm/bin}:${PATH:-}"

if [[ -n "${CHEMLAKE_ENV_FILE:-}" && -f "${CHEMLAKE_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${CHEMLAKE_ENV_FILE}"
elif [[ -f slurm/env.sh ]]; then
  # shellcheck disable=SC1091
  source slurm/env.sh
fi

JOB_NAME="${CHEMLAKE_ORCHESTRATOR_JOB_NAME:-chemlake-orchestrator}"
SBATCH_FILE="${CHEMLAKE_ORCHESTRATOR_SBATCH:-slurm/chemlake-orchestrator.sbatch}"
MAX_INSTANCES="${CHEMLAKE_ORCHESTRATOR_MAX_INSTANCES:-1}"
SQUEUE_STATES="${CHEMLAKE_ORCHESTRATOR_SQUEUE_STATES:-PENDING,RUNNING,CONFIGURING,COMPLETING,RESIZING,SUSPENDED}"
LOG_DIR="${CHEMLAKE_ORCHESTRATOR_CRON_LOG_DIR:-${ROOT}/logs}"
LOCK_DIR="${CHEMLAKE_ORCHESTRATOR_CRON_LOCK_DIR:-${LOG_DIR}/.chemlake-orchestrator.ensure.lock}"
mkdir -p "$LOG_DIR"

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*"
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "another ensure_chemlake_orchestrator.sh instance is already running; exiting"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

if ! command -v squeue >/dev/null 2>&1; then
  log "squeue is not available; run this cron on a Hive/Slurm login or submit host"
  exit 2
fi
if ! command -v sbatch >/dev/null 2>&1; then
  log "sbatch is not available; run this cron on a Hive/Slurm login or submit host"
  exit 2
fi
if ! command -v scancel >/dev/null 2>&1; then
  log "scancel is not available; run this cron on a Hive/Slurm login or submit host"
  exit 2
fi
if [[ ! -f "$SBATCH_FILE" ]]; then
  log "missing orchestrator sbatch file: $SBATCH_FILE"
  exit 2
fi

runner_command() {
  if [[ -n "${CHEMLAKE_ORCHESTRATOR_RUNNER:-}" ]]; then
    # Intentional word splitting lets operators set e.g. "uv run chemlake".
    # shellcheck disable=SC2206
    local runner=( ${CHEMLAKE_ORCHESTRATOR_RUNNER} )
    "${runner[@]}" "$@"
  elif command -v uv >/dev/null 2>&1; then
    uv run chemlake "$@"
  else
    chemlake "$@"
  fi
}

heartbeat_is_fresh() {
  if [[ "${CHEMLAKE_ORCHESTRATOR_CRON_CHECK_HEARTBEAT:-1}" != "1" ]]; then
    return 0
  fi
  local orch_source="${CHEMLAKE_ORCH_SOURCE:-all}"
  local health_source="${CHEMLAKE_ORCHESTRATOR_HEALTH_SOURCE:-pubchem}"
  if [[ "$orch_source" != "all" ]]; then
    health_source="$orch_source"
  fi
  local base_run_id="${CHEMLAKE_ORCHESTRATOR_RUN_ID:-orchestrator:${orch_source}:service}"
  local run_id="$base_run_id"
  if [[ "$orch_source" == "all" ]]; then
    run_id="${base_run_id}:${health_source}"
  fi
  runner_command orchestrate "$health_source" \
    --assert-service \
    --orchestrator-run-id "$run_id" \
    --orchestrator-heartbeat-minutes "${CHEMLAKE_ORCHESTRATOR_HEARTBEAT_MINUTES:-10}" >/dev/null
}

SLURM_USER="${CHEMLAKE_ORCHESTRATOR_SLURM_USER:-${USER:-$(id -un)}}"
SQUEUE_OUTPUT="$(squeue --noheader --user "$SLURM_USER" --name "$JOB_NAME" --states "$SQUEUE_STATES" --format '%i|%T|%j' || true)"
ACTIVE_COUNT="$(printf '%s\n' "$SQUEUE_OUTPUT" | awk 'NF { count++ } END { print count + 0 }')"

if (( ACTIVE_COUNT > MAX_INSTANCES )); then
  log "found $ACTIVE_COUNT active $JOB_NAME jobs for $SLURM_USER; maximum allowed is $MAX_INSTANCES"
  printf '%s\n' "$SQUEUE_OUTPUT" >&2
  exit 1
fi

if (( ACTIVE_COUNT == MAX_INSTANCES )); then
  if ! heartbeat_is_fresh; then
    log "$JOB_NAME has $ACTIVE_COUNT active Slurm job but Postgres heartbeat is stale; cancelling and replacing"
    printf '%s\n' "$SQUEUE_OUTPUT" | awk -F'|' 'NF { print $1 }' | while read -r job_id; do
      [[ -n "$job_id" ]] && scancel "$job_id"
    done
    SUBMIT_OUTPUT="$(sbatch "$SBATCH_FILE")"
    log "submitted orchestrator replacement: $SUBMIT_OUTPUT"
    exit 0
  fi
  log "$JOB_NAME already active for $SLURM_USER ($ACTIVE_COUNT/$MAX_INSTANCES); no submit needed"
  exit 0
fi

log "no active $JOB_NAME job found for $SLURM_USER; submitting $SBATCH_FILE"
SUBMIT_OUTPUT="$(sbatch "$SBATCH_FILE")"
log "submitted orchestrator: $SUBMIT_OUTPUT"
