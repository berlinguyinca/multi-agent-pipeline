#!/usr/bin/env bash
#SBATCH --job-name=source-worker
#SBATCH --output=logs/source-worker-%j.out
#SBATCH --error=logs/source-worker-%j.err
#SBATCH --time=24:00:00
#SBATCH --cpus-per-task=1
#SBATCH --mem=4G

set -euo pipefail
ROOT="${CHEMLAKE_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"

if [[ -n "${CHEMLAKE_ENV_FILE:-}" && -f "${CHEMLAKE_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${CHEMLAKE_ENV_FILE}"
elif [[ -f slurm/env.sh ]]; then
  # shellcheck disable=SC1091
  source slurm/env.sh
fi

SOURCE="${CHEMLAKE_SOURCE:-${CHEMLAKE_ORCH_SOURCE:-}}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      SOURCE="$2"; shift 2 ;;
    --snapshot)
      export SNAPSHOT="$2"; shift 2 ;;
    --worker-id)
      export CHEMLAKE_WORKER_ID="$2"; shift 2 ;;
    *)
      shift ;;
  esac
done
: "${SOURCE:?Set CHEMLAKE_SOURCE or pass --source}"
export CHEMLAKE_ORCH_SOURCE="$SOURCE"

source slurm/lib/common.sh
# setup_runtime checks CHEMLAKE_ORCHESTRATOR_RUN_ID against the Postgres
# orchestrator heartbeat before any generic source worker does production work.
setup_runtime

WORKER_ID="${CHEMLAKE_WORKER_ID:-${SOURCE}-worker-${SLURM_JOB_ID:-$$}}"
LIMIT="${CHEMLAKE_SOURCE_WORKER_LIMIT:-1}"

run_chem sources worker \
  --source "$SOURCE" \
  --worker-id "$WORKER_ID" \
  --limit "$LIMIT" \
  --root "$CHEMLAKE_ROOT"
