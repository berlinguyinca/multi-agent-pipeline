# Blocked source download handoff

Claude/Codex can orchestrate downloads and validation, but it must not bypass access controls, accept licenses on a user's behalf, or commit restricted data.

## HMDB

Official downloads: <https://www.hmdb.ca/downloads>. HMDB publishes XML data downloads and states that significant reuse should cite HMDB and commercial reuse requires permission.

```bash
# After reviewing HMDB terms and copying the All Metabolites XML download URL:
HMDB_DOWNLOAD_URL='<hmdb all-metabolites xml url>' \
  CHEMLAKE_ROOT=/path/to/chemlake \
  workspace/scripts/fetch_hmdb.sh

export HMDB_XML=/path/to/chemlake/work/sources/hmdb/<downloaded-file-or-folder>
uv run chemlake sources verify-live --from ../slurm/sources.tsv
```

For this repo, `workspace/config/source-paths.env` already points `HMDB_XML` at `../work/sources/hmdb`, so you can also drop all manually downloaded HMDB files into `workspace/work/sources/hmdb/` and rerun live verification without setting an environment variable.


### Current local HMDB location

This checkout is configured to use the manually downloaded HMDB zip directory at:

```text
/Users/wohlgemuth/IdeaProjects/chem-evidence/data/work/sources/hmdb
```

Inventory metadata is saved in `workspace/config/hmdb-source-manifest.json`. The adapter scans zip files in place and does not require manual extraction for live verification.

## DrugBank

DrugBank XML is documented at <https://docs.drugbank.com/xml/>. Obtain approved access and download the release manually from DrugBank; do not script login or commit the file.

```bash
python workspace/scripts/stage_restricted_source.py \
  --source drugbank \
  --input /path/to/drugbank/full_database.xml \
  --chemlake-root /path/to/chemlake \
  --copy

export DRUGBANK_INPUT=/path/to/chemlake/work/sources/drugbank/full_database.xml
```

## T3DB

Official downloads are described at <https://t3db.org/downloads>, but current live probes have observed 502/TLS failures. Use an operator-provided export or mirror URL.

```bash
T3DB_DOWNLOAD_URL='<operator-approved t3db export url>' \
  CHEMLAKE_ROOT=/path/to/chemlake \
  workspace/scripts/fetch_t3db.sh

# or stage an existing file
python workspace/scripts/stage_restricted_source.py --source t3db --input /path/to/t3db.jsonl --chemlake-root /path/to/chemlake --copy
export T3DB_INPUT=/path/to/chemlake/work/sources/t3db/t3db.jsonl
```

## CAS Common Chemistry

Request API access at <https://www.cas.org/services/commonchemistry-api>. After CAS provides access, set a pre-authorized probe URL.

```bash
export CAS_COMMON_CHEMISTRY_API_URL='<authorized CAS Common Chemistry API search/detail URL>'
uv run chemlake sources verify-live --from ../slurm/sources.tsv
```

## Safety rules

- Keep source dumps under `$CHEMLAKE_ROOT/work/sources/`, not in git.
- Store credentials/API keys in environment or secret config only.
- Save checksums in generated manifests and rerun `chemlake sources verify-live` after staging.
