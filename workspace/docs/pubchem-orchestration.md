# Chemlake production orchestration

The production Chemlake mirror is tracked in Postgres under the `chemlake` schema. The live counters come from `remote_objects` and `blob_store`, not the older local `accessions` / `mirror_objects` SQLite-style queue.

## Diagnosed stuck state on 2026-04-24

Read-only production probes showed:

- `chemlake.remote_objects`: 23,075 `planned`, 1,505 `downloaded`, and 45 `claimed` PubChem objects.
- `chemlake.blob_store`: 1,510 PubChem blobs totaling 274,553,680,260 bytes.
- Last PubChem blob update: 2026-04-24 14:31:29 UTC.
- `chemlake.accessions` and `chemlake.mirror_objects`: zero PubChem rows, confirming that the newer remote-object catalog is the source of truth.

The likely failure mode is a stopped worker lane that left claimed remote objects behind.

## Orchestrator responsibilities

`chemlake orchestrate all --sources-from slurm/sources.tsv` runs on Hive where `sbatch`, `squeue`/`sacct`, and `/quobyte` are available. It keeps the mirror moving by using Postgres as the only tracking plane:

- reads `remote_objects` status counts and `blob_store` bytes,
- reconciles `sync_runs` with Slurm job state via `sacct`,
- moves stale `claimed` remote objects back to `planned`,
- marks stale `sync_runs` as `stale`,
- submits replacement workers up to `--target-workers`, and
- records submitted Slurm job ids in `sync_runs`.

The orchestration service is also the launch gate. It writes a fresh orchestrator heartbeat into `sync_runs` on every active loop. Worker jobs receive `CHEMLAKE_ORCHESTRATOR_RUN_ID` from the service and must verify that heartbeat before doing Postgres-backed work.

`chemlake pubchem plan --dataset all` discovers the major PubChem FTP database areas and stores them in `remote_objects` for the orchestrator-managed workers:

- Compound: current full ASN/SDF/XML, Daily, Weekly, Monthly, Extras
- Substance: current full ASN/SDF/XML, Daily, Weekly, Monthly, Extras
- BioAssay: ASN, XML, JSON, CSV, Concise, Extras, AssayNeighbors
- Compound_3D, RDF, Target, Cooccurrence, Literature, Patents, and Other

`slurm/chemlake-orchestrator.sbatch` runs that planner at startup by default (`CHEMLAKE_PUBCHEM_PLAN_ON_START=1`, `CHEMLAKE_PUBCHEM_PLAN_DATASETS=all`) before entering the keepalive loop.

Use `--dry-run --once` first. Dry-run mode is read-only and reports `would_submit_workers`.

## Operational command

```bash
export CHEMLAKE_ORCHESTRATOR_SUBMIT_COMMAND='sbatch --parsable --dependency=after:{orchestrator_job_id} --export=ALL,CHEMLAKE_JOB_ROLE=worker,CHEMLAKE_ORCHESTRATOR_RUN_ID={orchestrator_run_id},CHEMLAKE_ORCH_SOURCE={source} --job-name {worker_id} slurm/chemlake-worker-dispatch.sbatch --source {source} --snapshot {snapshot}'

chemlake orchestrate all \
  --sources-from slurm/sources.tsv \
  --target-workers 4 \
  --stale-claim-minutes 90 \
  --stale-run-minutes 180 \
  --poll-seconds 300 \
  --submit-command "$CHEMLAKE_ORCHESTRATOR_SUBMIT_COMMAND"
```

The worker submit command may differ by Hive deployment; it only needs to accept `{source}`, `{worker_id}`, and `{snapshot}` placeholders and print a Slurm job id.
It should also preserve `{orchestrator_run_id}` and `{orchestrator_job_id}` in the dependency/export options so direct worker starts remain blocked.
The CLI rejects non-dry-run submit commands that omit those orchestration placeholders.

## Hive-resident service job

The orchestrator must run on Hive, because only Hive can start and observe ingestion jobs. Hazy is only the Postgres server; Hive must reach it through the private 10G address `172.27.108.100`. Submit the orchestrator itself as a long-lived Slurm job:

```bash
cp slurm/env.example.sh slurm/env.sh
# edit slurm/env.sh or source cluster-managed secrets for CHEMLAKE_POSTGRES_PASSWORD
sbatch slurm/chemlake-orchestrator.sbatch
```

`slurm/chemlake-orchestrator.sbatch` loads `slurm/env.sh` (or `$CHEMLAKE_ENV_FILE`), connects to the production Postgres database, runs `chemlake orchestrate all --sources-from slurm/sources.tsv`, and continually resubmits replacement workers until no planned source objects remain.

## Cron auto-start

Install the cron supervisor on a Hive/Slurm submit host:

```bash
scripts/install_chemlake_orchestrator_cron.sh
```

The generated cron entry runs every five minutes and executes `scripts/ensure_chemlake_orchestrator.sh`. That script:

1. uses `squeue` to count pending/running `chemlake-orchestrator` jobs for the current user,
2. submits `slurm/chemlake-orchestrator.sbatch` with `sbatch` when the count is zero,
3. exits without submitting when exactly one exists, and
4. exits with an error when more than one exists, preserving the "total of one orchestrator" invariant.

`slurm/chemlake-orchestrator.cron` is a plain-text example for sites that manage crontabs through configuration management instead of the installer script.

All future ingestion/server workers should be started by this service. Direct `sbatch` starts will fail for scripts that use `slurm/lib/common.sh` because `setup_runtime` requires a valid `CHEMLAKE_ORCHESTRATOR_RUN_ID` and a fresh Postgres heartbeat unless `CHEMLAKE_JOB_ROLE=orchestrator` or `CHEMLAKE_REQUIRE_ORCHESTRATOR=0` is explicitly set for non-production maintenance.


## Generic source planning

At startup the Hive orchestrator also runs `chemlake sources plan-work --from ${CHEMLAKE_SOURCES_TSV:-slurm/sources.tsv} --source all`. This schedules every enabled non-PubChem source in the registry into Postgres `remote_objects`; PubChem still uses the PubChem FTP planner because its FTP tree expands to many files. `slurm/chemlake-worker-dispatch.sbatch` routes PubChem work to `chemlake pubchem worker` and all other sources to `chemlake sources worker`.
