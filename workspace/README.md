# PubChem Sync + Chemlake Resolver

This workspace contains the original PubChem sync/Markdown conversion tooling and a dependency-free Chemlake resolver subsystem.

## Chemlake local resolver

The `chem_evidence.resolver` package resolves chemical names and identifiers strictly from local lake artifacts. It does **not** call CACTUS, PubChem, CTS, or any other request-time network service.

Supported local artifact files include:

- `compound_identity.jsonl` (also `compounds.jsonl`, `identity.jsonl`, or `records.jsonl`)
- `xrefs.jsonl`
- `synonyms.jsonl`
- `spectra.jsonl`
- `evidence.jsonl`
- `manifest.json` / `freshness.json`

Common fields are preserved and indexed: preferred names, synonyms, PubChem CID/SID, CAS, HMDB, ChEBI, KEGG, LipidMaps, DrugBank, CompTox/DSSTox, SPLASH, formula, exact/monoisotopic mass, InChI, InChIKey, SMILES, structure payloads, evidence counts, usage/commonness, provenance, and source freshness.

### CLI

```bash
chemlake --data-dir ./lake resolve --input queries.txt --to all --confidence
chemlake --data-dir ./lake resolve --input - --from auto --to inchikey,smiles --format csv
chemlake --data-dir ./lake discover --input article.txt --to all --confidence
chemlake --data-dir ./lake translate --input queries.txt --to pubchem_cid
```

`translate` is a compatibility alias over `resolve`.

### API

Frameworks can delegate REST handlers to the dependency-free API shim:

```python
from chem_evidence.api import handle_post

response = handle_post("/resolve", {
    "data_dir": "./lake",
    "queries": ["CID:2244", "aspirin"],
    "to": "all",
    "confidence": True,
})
```

Supported endpoint paths are `/resolve`, `/discover`, and `/translate`; `/translate` delegates to `/resolve`.


### Supported database routing graph

The resolver routing graph and database support matrix are generated from a single updateable catalog:

- Markdown: [`docs/chemlake-resolver-routing.md`](docs/chemlake-resolver-routing.md)
- Mermaid graph source: [`docs/chemlake-resolver-routing.mmd`](docs/chemlake-resolver-routing.mmd)
- Presentation PNG: [`docs/chemlake-resolver-routing.png`](docs/chemlake-resolver-routing.png)
- Individual database READMEs: [`docs/chemlake-resolver-databases/README.md`](docs/chemlake-resolver-databases/README.md)

To update the documentation, per-database READMEs, and shareable graph after adding a database/namespace/route, edit `src/chem_evidence/routing_catalog.py` and run:

```bash
python scripts/generate_resolver_docs.py
```

### CACTUS parity note

Chemlake reproduces CACTUS-style conversion capability only when the representation is available or derivable from local lake data. NCI/CADD identifiers such as FICTS, FICuS, `uuuuu`, and HASHISY return explicit “not available locally” warnings until their algorithms or stored values are added locally.

## Sync-state database

Chemlake sync state is stored in a small operational database that tracks source definitions, pending accessions, retry/download status, local mirror paths, hashes, and run metadata. Payloads remain in the filesystem and normalized scientific data remains in JSONL/Parquet/DuckDB outputs.

Local development defaults to SQLite:

```bash
export CHEMLAKE_DB_BACKEND=sqlite
export CHEMLAKE_SQLITE_PATH="${CHEMLAKE_ROOT:-$PWD}/work/state/chemlake-sync.sqlite"
chemlake sync-state init
chemlake sources import --from ../slurm/sources.tsv
chemlake sync pending --source pubchem --limit 10
chemlake sync mark-downloaded --source pubchem --accession CID:2244 --local-path raw/pubchem/CID2244.json
chemlake sync report --snapshot "$(date +%Y-%m-%d)"
```

Hive/Slurm production uses Postgres by setting `CHEMLAKE_DB_BACKEND=postgres` and supplying credentials through environment/secret configuration. The default production target from Hive is Hazy Postgres on the private 10G address `172.27.108.100:6432`, database `chemlake`; `slurm/env.example.sh` documents the variables and intentionally leaves credentials blank.

### Production orchestration service

`chemlake orchestrate` is intended to run on a Hive/Slurm node, not on Hazy. Hazy is only the Postgres server and Hive connects to it over the private 10G address `172.27.108.100`. It keeps Postgres-tracked ingestion jobs alive without creating a second state store. It uses the production `chemlake.remote_objects`, `chemlake.blob_store`, and `chemlake.sync_runs` tables as the authority for progress, stale-claim recovery, Slurm job reconciliation, and worker run tracking. It does not use local SQLite, local lock files, or `download_jobs` for production source catalog orchestration.

The service performs one safe control loop per pass:

1. read source progress from `remote_objects` and `blob_store`,
2. reconcile active `sync_runs` against Slurm via `sacct`,
3. release stale `remote_objects.status = 'claimed'` rows back to `planned`,
4. mark stale worker `sync_runs` as `stale`,
5. count active `submitted`/`running` worker runs still inside the freshness window,
6. refresh the orchestrator heartbeat in `sync_runs`,
7. submit enough Slurm workers to reach the target concurrency through the service only, and
8. insert each submitted worker back into `sync_runs` with `metadata.job_id`, `metadata.label`, `metadata.orchestrated = true`, and the parent `metadata.orchestrator_run_id`.

Workers are expected to be launched by the orchestration service, not manually. The default Hive submit template adds a Slurm `--dependency=after:{orchestrator_job_id}` and exports `CHEMLAKE_ORCHESTRATOR_RUN_ID` into each worker. Worker scripts that use `slurm/lib/common.sh` call `setup_runtime`, which refuses to start Postgres-backed work unless that orchestrator run id points at a fresh running service heartbeat in Postgres.
Non-dry-run orchestration refuses unmanaged submit templates that omit `{orchestrator_run_id}` or `{orchestrator_job_id}`.

Dry-run mode is read-only: it reports current counts and how many workers would be submitted without releasing claims, marking runs stale, submitting jobs, or inserting run records.

On Hive startup, `slurm/chemlake-orchestrator.sbatch` plans all configured source work before entering the keepalive loop:

- `CHEMLAKE_PUBCHEM_PLAN_ON_START=1` (the default) runs `chemlake pubchem plan`. `CHEMLAKE_PUBCHEM_PLAN_DATASETS=all` plans the major PubChem FTP databases into `remote_objects`: Compound full/incremental/extras, Substance full/incremental/extras, BioAssay ASN/XML/JSON/CSV/Concise/extras/neighbors, Compound_3D, RDF, Target, Cooccurrence, Literature, Patents, and Other. For staged rollouts set `CHEMLAKE_PUBCHEM_PLAN_DATASETS=default` or a comma-separated dataset list.
- `CHEMLAKE_SOURCE_PLAN_ON_START=1` (the default) runs `chemlake sources plan-work --from ${CHEMLAKE_SOURCES_TSV:-slurm/sources.tsv} --source all`, which adds one Postgres `remote_objects` work item for each enabled non-PubChem source in the registry (`pubmed`, `hmdb`, `drugbank`, `chebi`, `kegg`, `chembl`, `mesh`, `dailymed`, `comptox`, `dsstox`, `unii`, `clinicaltrials`, `wikidata`, `lipidmaps`, `massbank`, `gnps`, `mona`, `blood-exposome`, `foodb`, `t3db`, `smpdb`, `metacyc`, `reactome`, `metabolomics-workbench`, `metabolights`, `cas-common-chemistry`, and `echa`). Excluded paid/restricted sources (`nist`, `mzcloud`) remain unplanned.

Example one-shot dry run on the production Hive login/worker environment. Use `--no-slurm-monitor` only when testing from a non-Hive host where `sacct` is unavailable:

```bash
export CHEMLAKE_DB_BACKEND=postgres
export CHEMLAKE_POSTGRES_HOST=172.27.108.100
export CHEMLAKE_POSTGRES_PORT=6432
export CHEMLAKE_POSTGRES_DB=chemlake
export CHEMLAKE_POSTGRES_USER=chemlake_app
export CHEMLAKE_POSTGRES_PASSWORD_ENV=CHEMLAKE_POSTGRES_PASSWORD
# export CHEMLAKE_POSTGRES_PASSWORD from the cluster secret store, not from git

chemlake orchestrate all \
  --sources-from slurm/sources.tsv \
  --once \
  --dry-run \
  --target-workers 4 \
  --stale-claim-minutes 90 \
  --stale-run-minutes 180 \
  --no-slurm-monitor
```

Example persistent service loop; the submit command must be a Slurm worker command that exits after submitting one worker and prints the Slurm job id, such as `Submitted batch job 13105561` or `13105561`:

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

To keep the control loop alive on Hive, submit the orchestrator itself as a long-running Slurm job from the checked-out workspace. Copy `slurm/env.example.sh` to `slurm/env.sh` or point `CHEMLAKE_ENV_FILE` at the cluster secret-managed environment first:

```bash
sbatch slurm/chemlake-orchestrator.sbatch
```

For automatic recovery, install the Hive cron supervisor from the same checkout. It runs every five minutes by default, checks Slurm for `chemlake-orchestrator` jobs owned by the current user, submits the service when zero are pending/running, and fails closed if more than one is visible:

```bash
scripts/install_chemlake_orchestrator_cron.sh
crontab -l | grep -A2 CHEMLAKE_ORCHESTRATOR_CRON_START
```

The installed cron line calls `scripts/ensure_chemlake_orchestrator.sh`; `slurm/chemlake-orchestrator.cron` contains an editable example if operators prefer manual crontab management.

For future Hive jobs, use the same pattern: add the worker/server command to `CHEMLAKE_ORCHESTRATOR_SUBMIT_COMMAND` (or a source-specific orchestrator env file) and let `chemlake orchestrate` submit it. Do not directly `sbatch` ingestion workers or long-running source servers except for the orchestrator service itself.

PubChem FTP plus generic source planning and worker commands:

```bash
chemlake pubchem datasets
chemlake pubchem plan --dataset all --max-depth 2
chemlake pubchem worker --source pubchem --worker-id "$HOSTNAME-$$" --limit 1 --root "$CHEMLAKE_ROOT"
chemlake sources plan-work --from slurm/sources.tsv --source all
chemlake sources worker --source pubmed --worker-id "$HOSTNAME-$$" --limit 1 --root "$CHEMLAKE_ROOT"
```

Install the optional Postgres runtime dependency in the production virtualenv before running the service:

```bash
uv sync --extra postgres
```

## Source adapter verification

The Slurm source registry (`../slurm/sources.tsv`) is backed by `chem_evidence.source_adapters`. Every registered source must have either:

- a working HTTP adapter contract with request construction and response parsing,
- a local-file adapter for access-restricted imports such as HMDB and DrugBank, or
- an explicit excluded adapter for paid/restricted libraries such as NIST and mzCloud.

Verify adapter coverage from the CLI:

```bash
chemlake sources verify-adapters --from ../slurm/sources.tsv
```

Probe real upstream datasource endpoints from the CLI:

```bash
chemlake sources verify-live --from ../slurm/sources.tsv
```

The integration test suite starts a real local HTTP server and exercises every enabled HTTP adapter against source-specific fixture payloads, while local import adapters read fixture files from disk. The live verification path also performs real remote probes for public datasources and reports credential-gated or upstream-blocked sources explicitly instead of pretending they passed.

Current blocked live checks have explicit operator remedies:

- `hmdb`: download the licensed/public HMDB metabolite XML/JSON/SDF snapshots from HMDB Downloads and either drop them in `workspace/work/sources/hmdb/` (configured in `workspace/config/source-paths.env`) or set `HMDB_XML=/path/to/hmdb_metabolites.xml` / `HMDB_XML=/path/to/hmdb-folder`.
- `drugbank`: after DrugBank access approval, set `DRUGBANK_INPUT=/path/to/full database.xml` (or a JSONL-converted snapshot).
- `t3db`: the public T3DB host has shown 502/TLS issues; stage a downloaded T3DB JSON/CSV/XML export and set `T3DB_INPUT=/path/to/t3db.jsonl`.
- `cas-common-chemistry`: request CAS Common Chemistry API access from CAS and set `CAS_COMMON_CHEMISTRY_API_URL` to an authorized search/detail probe URL.

ECHA live probing uses the newer ECHA CHEM API endpoint (`chem.echa.europa.eu/api-substance/v1/substance?...`) rather than the older `echa.europa.eu/substance-information` pages.

## Metabolomics evidence indexing

Chemlake can harvest processed metabolomics study metadata/result tables and index them for biological cross-reference queries. V1 focuses on processed tables and metadata, not raw vendor files.

Supported source adapters:

- Metabolomics Workbench / NMDR (`mw`)
- MetaboLights (`metabolights`)
- GNPS/MassIVE (`gnps`)
- MetabolomeXchange discovery records (`metabolomexchange`)
- MetabolomicsHub discovery records (`hub`)
- PubMed publication metadata (`pubmed`)

Every normalized row includes governance fields: source name/accession/URL, source record type, retrieved timestamp, content hash, parser version, and source terms note.

```bash
# Full local mirror of repository objects (metadata, processed tables, and raw archive URLs when exposed)
chemlake --data-dir ./lake metabolomics mirror --source mw --all
chemlake --data-dir ./lake metabolomics mirror --source metabolights --all

# Normalize processed metadata/results into queryable tables
chemlake --data-dir ./lake metabolomics harvest --source mw --accession ST000001
chemlake --data-dir ./lake metabolomics harvest --source pubmed --pmid 12345678
chemlake --data-dir ./lake metabolomics index
chemlake --data-dir ./lake metabolomics query --compound aspirin --species mouse --organ liver --genotype "Ppara -/-"
```

The mirror command writes governed files and `metabolomics/mirror/mirror_manifest.jsonl`; use `--processed-only` to skip raw archive URLs and `--limit N` for staged mirroring. The index builder writes DuckDB plus Parquet products under `metabolomics/` (`index.duckdb`, `studies.parquet`, `samples.parquet`, `results.parquet`, `publications.parquet`, `compound_links.parquet`, and `provenance.parquet`). Existing `chemlake resolve --to all` responses include linked metabolomics evidence summaries when matching result records are present in the lake.

## Verification

```bash
uvx ruff check src tests scripts
uv run python -m compileall -q src tests scripts
uv run pytest -q
```
