#!/usr/bin/env bash
# Copy to slurm/env.sh and edit for Hive before submitting.
# This file is intentionally conservative: one CPU per job and source-specific memory knobs.

export CHEMLAKE_ROOT="${CHEMLAKE_ROOT:-/quobyte/metabolomicsgrp/it/chemlake}"
export REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export SNAPSHOT="${SNAPSHOT:-$(date +%Y-%m-%d)}"

# Sync-state database. From Hive, connect to Hazy Postgres over the private 10G address 172.27.108.100.
# Sync-state database. Hive/Slurm uses Postgres; local development can override
# CHEMLAKE_DB_BACKEND=sqlite without requiring production credentials.
export CHEMLAKE_DB_BACKEND="${CHEMLAKE_DB_BACKEND:-postgres}"
export CHEMLAKE_POSTGRES_HOST="${CHEMLAKE_POSTGRES_HOST:-172.27.108.100}"
export CHEMLAKE_POSTGRES_PORT="${CHEMLAKE_POSTGRES_PORT:-6432}"
export CHEMLAKE_POSTGRES_DB="${CHEMLAKE_POSTGRES_DB:-chemlake}"
export CHEMLAKE_POSTGRES_USER="${CHEMLAKE_POSTGRES_USER:-}"
export CHEMLAKE_POSTGRES_PASSWORD_ENV="${CHEMLAKE_POSTGRES_PASSWORD_ENV:-CHEMLAKE_POSTGRES_PASSWORD}"
export CHEMLAKE_SQLITE_PATH="${CHEMLAKE_SQLITE_PATH:-${CHEMLAKE_ROOT}/work/state/chemlake-sync.sqlite}"

# Hive Slurm details: set these in slurm/env.sh if required by the cluster.
export SLURM_ACCOUNT="${SLURM_ACCOUNT:-}"
export SLURM_PARTITION="${SLURM_PARTITION:-}"
export SLURM_QOS="${SLURM_QOS:-}"
export SLURM_TIME_DEFAULT="${SLURM_TIME_DEFAULT:-24:00:00}"
export SLURM_CPUS_PER_TASK="${SLURM_CPUS_PER_TASK:-1}"

# Per-job memory defaults. Override in slurm/env.sh as real source sizes become clear.
export INIT_LAYOUT_MEM="${INIT_LAYOUT_MEM:-1G}"
export PUBCHEM_PLAN_MEM="${PUBCHEM_PLAN_MEM:-2G}"
export PUBCHEM_FETCH_MEM="${PUBCHEM_FETCH_MEM:-4G}"
export PUBCHEM_TRANSFORM_MEM="${PUBCHEM_TRANSFORM_MEM:-32G}"
export PUBMED_FETCH_MEM="${PUBMED_FETCH_MEM:-4G}"
export RAW_FETCH_MEM="${RAW_FETCH_MEM:-4G}"
export LOCAL_IMPORT_MEM="${LOCAL_IMPORT_MEM:-16G}"
export INTEGRATE_MEM="${INTEGRATE_MEM:-8G}"

# Runtime setup. Example for Hive if needed:
# export CHEM_EVIDENCE_SETUP='module load python/3.11; export PATH="$HOME/.local/bin:$PATH"'
export CHEM_EVIDENCE_SETUP="${CHEM_EVIDENCE_SETUP:-}"
export UV_BIN="${UV_BIN:-uv}"
export CHEMLAKE_REQUIRE_ORCHESTRATOR="${CHEMLAKE_REQUIRE_ORCHESTRATOR:-1}"
export CHEMLAKE_ORCHESTRATOR_HEARTBEAT_MINUTES="${CHEMLAKE_ORCHESTRATOR_HEARTBEAT_MINUTES:-10}"
export CHEMLAKE_ORCH_SOURCE="${CHEMLAKE_ORCH_SOURCE:-all}"
export CHEMLAKE_ORCHESTRATOR_JOB_NAME="${CHEMLAKE_ORCHESTRATOR_JOB_NAME:-chemlake-orchestrator}"
export CHEMLAKE_ORCHESTRATOR_MAX_INSTANCES="${CHEMLAKE_ORCHESTRATOR_MAX_INSTANCES:-1}"
export CHEMLAKE_PUBCHEM_PLAN_ON_START="${CHEMLAKE_PUBCHEM_PLAN_ON_START:-1}"
export CHEMLAKE_PUBCHEM_PLAN_DATASETS="${CHEMLAKE_PUBCHEM_PLAN_DATASETS:-all}"
export CHEMLAKE_PUBCHEM_PLAN_MAX_DEPTH="${CHEMLAKE_PUBCHEM_PLAN_MAX_DEPTH:-2}"
export CHEMLAKE_SOURCES_TSV="${CHEMLAKE_SOURCES_TSV:-slurm/sources.tsv}"
export CHEMLAKE_SOURCE_PLAN_ON_START="${CHEMLAKE_SOURCE_PLAN_ON_START:-1}"
export CHEMLAKE_SOURCE_PLAN_SOURCES="${CHEMLAKE_SOURCE_PLAN_SOURCES:-all}"
if [[ -z "${CHEMLAKE_ORCHESTRATOR_SUBMIT_COMMAND:-}" ]]; then
  export CHEMLAKE_ORCHESTRATOR_SUBMIT_COMMAND='sbatch --parsable --dependency=after:{orchestrator_job_id} --export=ALL,CHEMLAKE_JOB_ROLE=worker,CHEMLAKE_ORCHESTRATOR_RUN_ID={orchestrator_run_id},CHEMLAKE_ORCH_SOURCE={source} --job-name {worker_id} slurm/chemlake-worker-dispatch.sbatch --source {source} --snapshot {snapshot}'
fi

# Source-specific knobs.
export PUBCHEM_DATASET="${PUBCHEM_DATASET:-compound-extras}"
export PUBCHEM_BUCKETS="${PUBCHEM_BUCKETS:-4096}"
export PUBMED_MAX_RESULTS="${PUBMED_MAX_RESULTS:-100}"
export PUBMED_QUERIES="${PUBMED_QUERIES:-${CHEMLAKE_ROOT}/work/manifests/pubmed-queries.jsonl}"
export NCBI_API_KEY_ENV="${NCBI_API_KEY_ENV:-NCBI_API_KEY}"
export NCBI_EMAIL="${NCBI_EMAIL:-}"
export NCBI_TOOL="${NCBI_TOOL:-chem-evidence}"

# Local import sources must be supplied by deployment after access/terms are confirmed.
export HMDB_XML="${HMDB_XML:-}"
export DRUGBANK_INPUT="${DRUGBANK_INPUT:-}"
export T3DB_INPUT="${T3DB_INPUT:-}"
export CAS_COMMON_CHEMISTRY_API_URL="${CAS_COMMON_CHEMISTRY_API_URL:-}"
