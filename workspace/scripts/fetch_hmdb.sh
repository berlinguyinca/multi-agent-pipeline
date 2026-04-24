#!/usr/bin/env bash
set -euo pipefail
: "${CHEMLAKE_ROOT:=${PWD}}"
: "${HMDB_DOWNLOAD_URL:=}"
: "${HMDB_SHA256:=}"
if [[ -z "${HMDB_DOWNLOAD_URL}" ]]; then
  cat >&2 <<'EOF'
HMDB_DOWNLOAD_URL is required. Visit https://www.hmdb.ca/downloads, review/accept
HMDB terms, copy the current All Metabolites XML download URL, then rerun:
  HMDB_DOWNLOAD_URL='<url>' workspace/scripts/fetch_hmdb.sh
EOF
  exit 2
fi
mkdir -p "${CHEMLAKE_ROOT}/work/sources/hmdb"
out="${CHEMLAKE_ROOT}/work/sources/hmdb/${HMDB_DOWNLOAD_URL##*/}"
curl --fail --location --continue-at - --retry 5 --retry-delay 10 --output "${out}.part" "${HMDB_DOWNLOAD_URL}"
mv "${out}.part" "${out}"
if [[ -n "${HMDB_SHA256}" ]]; then
  printf '%s  %s\n' "${HMDB_SHA256}" "${out}" | shasum -a 256 -c -
fi
python "$(dirname "$0")/stage_restricted_source.py" --source hmdb --input "${out}" --chemlake-root "${CHEMLAKE_ROOT}"
