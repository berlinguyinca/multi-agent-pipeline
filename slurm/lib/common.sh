#!/usr/bin/env bash
set -euo pipefail

SLURM_DIR="${SLURM_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
if [[ -f "${SLURM_DIR}/env.sh" ]]; then
  # shellcheck source=/dev/null
  source "${SLURM_DIR}/env.sh"
else
  # shellcheck source=/dev/null
  source "${SLURM_DIR}/env.example.sh"
fi

export CHEMLAKE_ROOT="${CHEMLAKE_ROOT:-/quobyte/metabolomicsgrp/it/chemlake}"
export REPO_ROOT="${REPO_ROOT:-$(cd "${SLURM_DIR}/.." && pwd)}"
export SNAPSHOT="${SNAPSHOT:-$(date +%Y-%m-%d)}"
export UV_BIN="${UV_BIN:-uv}"
export CHEMLAKE_REQUIRE_ORCHESTRATOR="${CHEMLAKE_REQUIRE_ORCHESTRATOR:-1}"
export CHEMLAKE_ORCHESTRATOR_HEARTBEAT_MINUTES="${CHEMLAKE_ORCHESTRATOR_HEARTBEAT_MINUTES:-10}"
export CHEMLAKE_ORCH_SOURCE="${CHEMLAKE_ORCH_SOURCE:-all}"

export CHEMLAKE_DB_BACKEND="${CHEMLAKE_DB_BACKEND:-postgres}"
export CHEMLAKE_POSTGRES_HOST="${CHEMLAKE_POSTGRES_HOST:-172.27.108.100}"
export CHEMLAKE_POSTGRES_PORT="${CHEMLAKE_POSTGRES_PORT:-6432}"
export CHEMLAKE_POSTGRES_DB="${CHEMLAKE_POSTGRES_DB:-chemlake}"
export CHEMLAKE_POSTGRES_USER="${CHEMLAKE_POSTGRES_USER:-}"
export CHEMLAKE_POSTGRES_PASSWORD_ENV="${CHEMLAKE_POSTGRES_PASSWORD_ENV:-CHEMLAKE_POSTGRES_PASSWORD}"
export CHEMLAKE_SQLITE_PATH="${CHEMLAKE_SQLITE_PATH:-${CHEMLAKE_ROOT}/work/state/chemlake-sync.sqlite}"

urlencode_component() {
  local python_bin="${PYTHON_BIN:-}"
  if [[ -z "${python_bin}" ]]; then
    if command -v python3 >/dev/null 2>&1; then
      python_bin="python3"
    elif command -v python >/dev/null 2>&1; then
      python_bin="python"
    else
      echo "Missing python3/python for URL encoding database credentials" >&2
      return 1
    fi
  fi
  "${python_bin}" -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""), end="")' "$1"
}

configure_database_url() {
  case "${CHEMLAKE_DB_BACKEND}" in
    sqlite)
      export CHEMLAKE_DATABASE_URL="sqlite:///${CHEMLAKE_SQLITE_PATH}"
      ;;
    postgres)
      if [[ -z "${CHEMLAKE_POSTGRES_USER:-}" ]]; then
        echo "Missing CHEMLAKE_POSTGRES_USER for CHEMLAKE_DB_BACKEND=postgres" >&2
        return 1
      fi
      local password_var="${CHEMLAKE_POSTGRES_PASSWORD_ENV}"
      local password="${!password_var:-}"
      if [[ -z "${password}" ]]; then
        echo "Missing ${password_var} for CHEMLAKE_DB_BACKEND=postgres" >&2
        return 1
      fi
      local encoded_user encoded_password encoded_db
      encoded_user="$(urlencode_component "${CHEMLAKE_POSTGRES_USER}")"
      encoded_password="$(urlencode_component "${password}")"
      encoded_db="$(urlencode_component "${CHEMLAKE_POSTGRES_DB}")"
      export CHEMLAKE_DATABASE_URL="postgresql://${encoded_user}:${encoded_password}@${CHEMLAKE_POSTGRES_HOST}:${CHEMLAKE_POSTGRES_PORT}/${encoded_db}"
      ;;
    *)
      echo "Unsupported CHEMLAKE_DB_BACKEND: ${CHEMLAKE_DB_BACKEND}" >&2
      return 1
      ;;
  esac
}

configure_database_url

RAW_DIR="${CHEMLAKE_ROOT}/raw"
NORMALIZED_DIR="${CHEMLAKE_ROOT}/normalized"
WORK_DIR="${CHEMLAKE_ROOT}/work"
MANIFEST_DIR="${WORK_DIR}/manifests"
LOG_DIR="${WORK_DIR}/logs"
SLURM_STATE_DIR="${WORK_DIR}/slurm"
RUN_DIR="${CHEMLAKE_ROOT}/runs/slurm-${SNAPSHOT}"

setup_runtime() {
  mkdir -p "${RAW_DIR}" "${NORMALIZED_DIR}" "${MANIFEST_DIR}" "${LOG_DIR}" "${SLURM_STATE_DIR}" "${RUN_DIR}"
  cd "${REPO_ROOT}"
  if [[ -n "${CHEM_EVIDENCE_SETUP:-}" ]]; then
    eval "${CHEM_EVIDENCE_SETUP}"
  fi
  require_orchestrator_service
}

log_info() {
  printf '[%s] %s\n' "$(date -Is)" "$*"
}

run_chem() {
  log_info "uv run chemlake $*"
  "${UV_BIN}" run chemlake "$@"
}

require_orchestrator_service() {
  if [[ "${CHEMLAKE_REQUIRE_ORCHESTRATOR:-1}" != "1" ]]; then
    return 0
  fi
  if [[ "${CHEMLAKE_DB_BACKEND}" != "postgres" ]]; then
    return 0
  fi
  if [[ "${CHEMLAKE_JOB_ROLE:-worker}" == "orchestrator" ]]; then
    return 0
  fi
  if [[ -z "${CHEMLAKE_ORCHESTRATOR_RUN_ID:-}" ]]; then
    echo "Missing CHEMLAKE_ORCHESTRATOR_RUN_ID; Hive workers must be launched by the Chemlake orchestration service" >&2
    return 1
  fi
  run_chem orchestrate "${CHEMLAKE_ORCH_SOURCE}" \
    --assert-service \
    --orchestrator-run-id "${CHEMLAKE_ORCHESTRATOR_RUN_ID}" \
    --orchestrator-heartbeat-minutes "${CHEMLAKE_ORCHESTRATOR_HEARTBEAT_MINUTES}"
}

write_scaffold_manifest() {
  local source_name="$1"
  local mode="$2"
  local output="${MANIFEST_DIR}/${source_name}-scaffold-${SNAPSHOT}.jsonl"
  mkdir -p "${RAW_DIR}/${source_name}/snapshot=${SNAPSHOT}" "${MANIFEST_DIR}"
  python - "$source_name" "$mode" "$SNAPSHOT" "$output" "${RAW_DIR}/${source_name}/snapshot=${SNAPSHOT}" <<'PY'
import json, sys
source, mode, snapshot, output, raw_path = sys.argv[1:]
row = {
    "source": source,
    "mode": mode,
    "snapshot": snapshot,
    "raw_path": raw_path,
    "status": "scaffolded",
    "message": "Source is registered for Hive deployment; add source-specific public URL/parser when available.",
}
with open(output, "w", encoding="utf-8") as handle:
    handle.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")
print(output)
PY
}

require_file() {
  local path="$1"
  local label="$2"
  if [[ -z "${path}" || ! -f "${path}" ]]; then
    echo "Missing ${label}: ${path}" >&2
    return 1
  fi
}
