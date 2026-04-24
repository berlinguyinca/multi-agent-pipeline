#!/usr/bin/env bash
set -euo pipefail
: "${CHEMLAKE_ROOT:=${PWD}}"
: "${T3DB_DOWNLOAD_URL:=}"
: "${T3DB_SHA256:=}"
if [[ -z "${T3DB_DOWNLOAD_URL}" ]]; then
  cat >&2 <<'EOF'
T3DB_DOWNLOAD_URL is required because the public T3DB host has been returning
502/TLS errors in live probes. Visit https://t3db.org/downloads or use an
operator-provided mirror/export URL, then rerun:
  T3DB_DOWNLOAD_URL='<url>' workspace/scripts/fetch_t3db.sh
Alternatively stage an existing export:
  python workspace/scripts/stage_restricted_source.py --source t3db --input /path/to/t3db.jsonl --chemlake-root "$CHEMLAKE_ROOT"
EOF
  exit 2
fi
mkdir -p "${CHEMLAKE_ROOT}/work/sources/t3db"
out="${CHEMLAKE_ROOT}/work/sources/t3db/${T3DB_DOWNLOAD_URL##*/}"
curl --fail --location --continue-at - --retry 8 --retry-delay 15 --output "${out}.part" "${T3DB_DOWNLOAD_URL}"
mv "${out}.part" "${out}"
if [[ -n "${T3DB_SHA256}" ]]; then
  printf '%s  %s\n' "${T3DB_SHA256}" "${out}" | shasum -a 256 -c -
fi
python "$(dirname "$0")/stage_restricted_source.py" --source t3db --input "${out}" --chemlake-root "${CHEMLAKE_ROOT}"
