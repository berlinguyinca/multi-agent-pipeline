#!/usr/bin/env bash
#SBATCH --job-name=chemlake-orchestrator
#SBATCH --output=logs/chemlake-orchestrator-%j.out
#SBATCH --error=logs/chemlake-orchestrator-%j.err
#SBATCH --time=7-00:00:00
#SBATCH --cpus-per-task=1
#SBATCH --mem=1G

set -euo pipefail

ROOT="${CHEMLAKE_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"
mkdir -p logs

if [[ -n "${CHEMLAKE_ENV_FILE:-}" && -f "${CHEMLAKE_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${CHEMLAKE_ENV_FILE}"
elif [[ -f slurm/env.sh ]]; then
  # shellcheck disable=SC1091
  source slurm/env.sh
fi

export CHEMLAKE_DB_BACKEND="${CHEMLAKE_DB_BACKEND:-postgres}"
: "${CHEMLAKE_ORCHESTRATOR_SUBMIT_COMMAND:?Set CHEMLAKE_ORCHESTRATOR_SUBMIT_COMMAND to an sbatch worker template}"
export CHEMLAKE_JOB_ROLE=orchestrator

SOURCE="${CHEMLAKE_ORCH_SOURCE:-all}"
TARGET_WORKERS="${CHEMLAKE_ORCH_TARGET_WORKERS:-4}"
STALE_CLAIM_MINUTES="${CHEMLAKE_ORCH_STALE_CLAIM_MINUTES:-90}"
STALE_RUN_MINUTES="${CHEMLAKE_ORCH_STALE_RUN_MINUTES:-180}"
STALE_CLAIM_LIMIT="${CHEMLAKE_ORCH_STALE_CLAIM_LIMIT:-500}"
POLL_SECONDS="${CHEMLAKE_ORCH_POLL_SECONDS:-300}"
SNAPSHOT="${CHEMLAKE_ORCH_SNAPSHOT:-}"
export CHEMLAKE_ORCHESTRATOR_JOB_ID="${CHEMLAKE_ORCHESTRATOR_JOB_ID:-${SLURM_JOB_ID:-}}"
export CHEMLAKE_ORCHESTRATOR_RUN_ID="${CHEMLAKE_ORCHESTRATOR_RUN_ID:-orchestrator:${SOURCE}:service}"

if [[ -n "${CHEMLAKE_ORCHESTRATOR_RUNNER:-}" ]]; then
  # Intentional word splitting lets operators set e.g. "uv run" or ".venv/bin/chemlake".
  # shellcheck disable=SC2206
  RUNNER=( ${CHEMLAKE_ORCHESTRATOR_RUNNER} )
elif command -v uv >/dev/null 2>&1; then
  RUNNER=(uv run chemlake)
else
  RUNNER=(chemlake)
fi

if [[ "${CHEMLAKE_PUBCHEM_PLAN_ON_START:-1}" == "1" ]]; then
  "${RUNNER[@]}" pubchem plan \
    --dataset "${CHEMLAKE_PUBCHEM_PLAN_DATASETS:-all}" \
    --max-depth "${CHEMLAKE_PUBCHEM_PLAN_MAX_DEPTH:-2}"
fi

if [[ "${CHEMLAKE_SOURCE_PLAN_ON_START:-1}" == "1" ]]; then
  "${RUNNER[@]}" sources plan-work \
    --from "${CHEMLAKE_SOURCES_TSV:-slurm/sources.tsv}" \
    --source "${CHEMLAKE_SOURCE_PLAN_SOURCES:-all}"
fi

exec "${RUNNER[@]}" orchestrate "$SOURCE" \
  --sources-from "${CHEMLAKE_SOURCES_TSV:-slurm/sources.tsv}" \
  --snapshot "$SNAPSHOT" \
  --target-workers "$TARGET_WORKERS" \
  --stale-claim-minutes "$STALE_CLAIM_MINUTES" \
  --stale-run-minutes "$STALE_RUN_MINUTES" \
  --stale-claim-limit "$STALE_CLAIM_LIMIT" \
  --poll-seconds "$POLL_SECONDS" \
  --submit-command "$CHEMLAKE_ORCHESTRATOR_SUBMIT_COMMAND" \
  --orchestrator-run-id "$CHEMLAKE_ORCHESTRATOR_RUN_ID" \
  --orchestrator-job-id "$CHEMLAKE_ORCHESTRATOR_JOB_ID"
