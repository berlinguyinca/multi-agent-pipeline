#!/usr/bin/env bash
#SBATCH --job-name=pubchem-worker
#SBATCH --output=logs/pubchem-worker-%j.out
#SBATCH --error=logs/pubchem-worker-%j.err
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

source slurm/lib/common.sh
# setup_runtime checks CHEMLAKE_ORCHESTRATOR_RUN_ID against the Postgres
# orchestrator heartbeat before any PubChem worker does production work.
setup_runtime

WORKER_ID="${CHEMLAKE_WORKER_ID:-${SLURM_JOB_NAME:-pubchem-worker}-${SLURM_JOB_ID:-$$}}"
LIMIT="${CHEMLAKE_PUBCHEM_WORKER_LIMIT:-1}"

run_chem pubchem worker \
  --source pubchem \
  --worker-id "$WORKER_ID" \
  --limit "$LIMIT" \
  --root "$CHEMLAKE_ROOT"
