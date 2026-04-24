#!/usr/bin/env bash
# Example Hive production environment for the Chemlake orchestrator.
# Copy to slurm/env.sh on Hive or export these variables from the cluster secret store.

export CHEMLAKE_DB_BACKEND=postgres
# Hazy is the Postgres host only; Hive workers should connect over the private 10G address.
export CHEMLAKE_POSTGRES_HOST=172.27.108.100
export CHEMLAKE_POSTGRES_PORT=6432
export CHEMLAKE_POSTGRES_DB=chemlake
export CHEMLAKE_POSTGRES_USER=chemlake_app
export CHEMLAKE_POSTGRES_PASSWORD_ENV=CHEMLAKE_POSTGRES_PASSWORD
# export CHEMLAKE_POSTGRES_PASSWORD=...  # keep real secrets out of git

# Command template used by the orchestrator to submit one ingestion worker.
# The orchestrator shell-quotes {source}, {worker_id}, {snapshot},
# {orchestrator_run_id}, and {orchestrator_job_id} before formatting.
# --dependency=after:{orchestrator_job_id} makes the worker Slurm job depend on
# the orchestrator job having started, and CHEMLAKE_ORCHESTRATOR_RUN_ID lets
# worker scripts verify a fresh service heartbeat in Postgres before doing work.
export CHEMLAKE_ORCHESTRATOR_SUBMIT_COMMAND='sbatch --parsable --dependency=after:{orchestrator_job_id} --export=ALL,CHEMLAKE_JOB_ROLE=worker,CHEMLAKE_ORCHESTRATOR_RUN_ID={orchestrator_run_id},CHEMLAKE_ORCH_SOURCE={source} --job-name {worker_id} slurm/chemlake-worker-dispatch.sbatch --source {source} --snapshot {snapshot}'

# Optional tuning knobs for slurm/chemlake-orchestrator.sbatch.
export CHEMLAKE_ORCH_SOURCE=all
export CHEMLAKE_ORCH_TARGET_WORKERS=4
export CHEMLAKE_ORCH_STALE_CLAIM_MINUTES=90
export CHEMLAKE_ORCH_STALE_RUN_MINUTES=180
export CHEMLAKE_ORCH_STALE_CLAIM_LIMIT=500
export CHEMLAKE_ORCH_POLL_SECONDS=300
export CHEMLAKE_PUBCHEM_PLAN_ON_START=1
export CHEMLAKE_PUBCHEM_PLAN_DATASETS=all
export CHEMLAKE_PUBCHEM_PLAN_MAX_DEPTH=2
export CHEMLAKE_SOURCES_TSV=slurm/sources.tsv
export CHEMLAKE_SOURCE_PLAN_ON_START=1
export CHEMLAKE_SOURCE_PLAN_SOURCES=all
export CHEMLAKE_ORCHESTRATOR_HEARTBEAT_MINUTES=10
export CHEMLAKE_REQUIRE_ORCHESTRATOR=1
export CHEMLAKE_ORCHESTRATOR_JOB_NAME=chemlake-orchestrator
export CHEMLAKE_ORCHESTRATOR_MAX_INSTANCES=1
