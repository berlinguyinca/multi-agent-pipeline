"""PubChem FTP planning and worker download support.

This module treats the PubChem FTP site as a catalog of remote objects.  The
planner discovers files from configured PubChem FTP directories and stores the
file metadata in Postgres `chemlake.remote_objects`; workers then claim planned
objects, download them on Hive, write bytes under CHEMLAKE_ROOT, and mark the
same Postgres rows downloaded.  The database remains the only tracking plane.
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import shutil
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence

from .sync_state import PostgresSyncState

PUBCHEM_FTP_ROOT = "https://ftp.ncbi.nlm.nih.gov/pubchem/"


@dataclass(frozen=True)
class PubChemFtpDatasetSpec:
    name: str
    path: str
    description: str
    recursive: bool = False

    @property
    def url(self) -> str:
        return PUBCHEM_FTP_ROOT + self.path


# Major PubChem FTP areas as described by PubChem's top-level README plus the
# current Compound/Substance/BioAssay layouts.  The names are stable operator
# handles; paths are intentionally explicit so operators can enable expensive
# datasets deliberately.
PUBCHEM_FTP_DATASETS: Dict[str, PubChemFtpDatasetSpec] = {
    "compound-current-sdf": PubChemFtpDatasetSpec("compound-current-sdf", "Compound/CURRENT-Full/SDF/", "Compound current full SDF chunks"),
    "compound-current-xml": PubChemFtpDatasetSpec("compound-current-xml", "Compound/CURRENT-Full/XML/", "Compound current full XML chunks"),
    "compound-current-asn": PubChemFtpDatasetSpec("compound-current-asn", "Compound/CURRENT-Full/ASN/", "Compound current full ASN.1 chunks"),
    "compound-extras": PubChemFtpDatasetSpec("compound-extras", "Compound/Extras/", "Compound auxiliary mapping files"),
    "compound-daily": PubChemFtpDatasetSpec("compound-daily", "Compound/Daily/", "Compound daily incrementals", recursive=True),
    "compound-weekly": PubChemFtpDatasetSpec("compound-weekly", "Compound/Weekly/", "Compound weekly incrementals", recursive=True),
    "compound-monthly": PubChemFtpDatasetSpec("compound-monthly", "Compound/Monthly/", "Compound monthly incrementals", recursive=True),
    "substance-current-sdf": PubChemFtpDatasetSpec("substance-current-sdf", "Substance/CURRENT-Full/SDF/", "Substance current full SDF chunks"),
    "substance-current-xml": PubChemFtpDatasetSpec("substance-current-xml", "Substance/CURRENT-Full/XML/", "Substance current full XML chunks"),
    "substance-current-asn": PubChemFtpDatasetSpec("substance-current-asn", "Substance/CURRENT-Full/ASN/", "Substance current full ASN.1 chunks"),
    "substance-extras": PubChemFtpDatasetSpec("substance-extras", "Substance/Extras/", "Substance auxiliary mapping files"),
    "substance-daily": PubChemFtpDatasetSpec("substance-daily", "Substance/Daily/", "Substance daily incrementals", recursive=True),
    "substance-weekly": PubChemFtpDatasetSpec("substance-weekly", "Substance/Weekly/", "Substance weekly incrementals", recursive=True),
    "substance-monthly": PubChemFtpDatasetSpec("substance-monthly", "Substance/Monthly/", "Substance monthly incrementals", recursive=True),
    "bioassay-json": PubChemFtpDatasetSpec("bioassay-json", "Bioassay/JSON/", "BioAssay JSON records"),
    "bioassay-csv": PubChemFtpDatasetSpec("bioassay-csv", "Bioassay/CSV/", "BioAssay CSV data and XML descriptions"),
    "bioassay-xml": PubChemFtpDatasetSpec("bioassay-xml", "Bioassay/XML/", "BioAssay XML records"),
    "bioassay-asn": PubChemFtpDatasetSpec("bioassay-asn", "Bioassay/ASN/", "BioAssay ASN.1 records"),
    "bioassay-concise": PubChemFtpDatasetSpec("bioassay-concise", "Bioassay/Concise/", "BioAssay concise results"),
    "bioassay-extras": PubChemFtpDatasetSpec("bioassay-extras", "Bioassay/Extras/", "BioAssay auxiliary files", recursive=True),
    "bioassay-neighbors": PubChemFtpDatasetSpec("bioassay-neighbors", "Bioassay/AssayNeighbors/", "BioAssay neighbor lists"),
    "compound-3d": PubChemFtpDatasetSpec("compound-3d", "Compound_3D/", "PubChem Compound 3-D data", recursive=True),
    "rdf": PubChemFtpDatasetSpec("rdf", "RDF/", "PubChem RDF data", recursive=True),
    "target": PubChemFtpDatasetSpec("target", "Target/", "PubChem target data", recursive=True),
    "cooccurrence": PubChemFtpDatasetSpec("cooccurrence", "Cooccurrence/", "PubChem co-occurrence data", recursive=True),
    "literature": PubChemFtpDatasetSpec("literature", "Literature/", "PubChem literature data", recursive=True),
    "patents": PubChemFtpDatasetSpec("patents", "Patents/", "PubChem patent data", recursive=True),
    "other": PubChemFtpDatasetSpec("other", "Other/", "Other PubChem data", recursive=True),
}

PUBCHEM_DEFAULT_DATASETS = (
    "compound-current-sdf",
    "compound-extras",
)

_INDEX_HREF_RE = re.compile(r'<a\s+href="(?P<href>[^"]+)">(?P<label>.*?)</a>(?P<trail>[^\n<]*)', re.IGNORECASE)
_SIZE_RE = re.compile(r"(?P<date>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(?P<size>[\d.]+[KMGTP]?|-)")


@dataclass(frozen=True)
class ApacheIndexEntry:
    name: str
    url: str
    size_bytes: Optional[int]
    last_modified: str
    md5_url: str = ""
    is_dir: bool = False


@dataclass(frozen=True)
class PubChemFtpObject:
    dataset: str
    name: str
    path: str
    url: str
    size_bytes: Optional[int]
    last_modified: str
    md5_url: str = ""

    @property
    def remote_key(self) -> str:
        return f"pubchem/{self.path}"

    def metadata(self) -> Dict[str, Any]:
        return {
            "dataset": self.dataset,
            "name": self.name,
            "path": self.path,
            "remote_key": self.remote_key,
            "url": self.url,
            "size_bytes": self.size_bytes,
            "last_modified": self.last_modified,
            "md5_url": self.md5_url,
        }


def parse_apache_index(text: str, base_url: str) -> List[ApacheIndexEntry]:
    md5_by_name: Dict[str, str] = {}
    entries: List[ApacheIndexEntry] = []
    for match in _INDEX_HREF_RE.finditer(text):
        href = html.unescape(match.group("href"))
        label = html.unescape(re.sub("<.*?>", "", match.group("label"))).strip()
        if href in {"../", "/"} or label.lower().startswith("parent directory"):
            continue
        is_dir = href.endswith("/")
        url = urllib.request.urljoin(base_url, href)
        if href.endswith(".md5"):
            md5_by_name[href[:-4]] = url
            continue
        size_bytes = None
        last_modified = ""
        size_match = _SIZE_RE.search(match.group("trail"))
        if size_match:
            last_modified = size_match.group("date")
            size_bytes = _parse_size(size_match.group("size"))
        if not is_dir and _is_data_file(href):
            entries.append(ApacheIndexEntry(name=href, url=url, size_bytes=size_bytes, last_modified=last_modified, is_dir=False))
        elif is_dir:
            entries.append(ApacheIndexEntry(name=href, url=url, size_bytes=None, last_modified=last_modified, is_dir=True))
    return [entry if entry.is_dir else ApacheIndexEntry(**{**entry.__dict__, "md5_url": md5_by_name.get(entry.name, "")}) for entry in entries]


def _parse_size(text: str) -> Optional[int]:
    if text == "-":
        return None
    unit = text[-1]
    if unit.isdigit():
        return int(text)
    value = float(text[:-1])
    scale = {"K": 1024, "M": 1024**2, "G": 1024**3, "T": 1024**4, "P": 1024**5}[unit]
    return int(value * scale)


def _is_data_file(name: str) -> bool:
    if name.endswith(".md5") or name.upper().startswith("README"):
        return False
    return True


def fetch_text(url: str) -> str:
    with urllib.request.urlopen(url) as response:
        return response.read().decode("utf-8", errors="replace")


class PubChemFtpPlanner:
    def __init__(self, store: Any, *, fetch_text: Callable[[str], str] = fetch_text):
        self.store = store
        self.fetch_text = fetch_text

    def plan(self, *, datasets: Sequence[str], limit: int = 0, max_depth: int = 2) -> Dict[str, Any]:
        selected = expand_dataset_names(datasets)
        objects: List[PubChemFtpObject] = []
        for dataset_name in selected:
            spec = PUBCHEM_FTP_DATASETS[dataset_name]
            objects.extend(self._objects_for_spec(spec, limit=max(0, limit - len(objects)) if limit else 0, max_depth=max_depth))
            if limit and len(objects) >= limit:
                objects = objects[:limit]
                break
        upserted = self.store.upsert_remote_objects(objects) if objects else 0
        return {"datasets": selected, "discovered": len(objects), "planned": upserted}

    def _objects_for_spec(self, spec: PubChemFtpDatasetSpec, *, limit: int = 0, max_depth: int = 2) -> List[PubChemFtpObject]:
        found: List[PubChemFtpObject] = []
        self._walk(spec, spec.url, spec.path, found, limit=limit, depth=0, max_depth=max_depth if spec.recursive else 0)
        return found

    def _walk(self, spec: PubChemFtpDatasetSpec, url: str, rel_path: str, found: List[PubChemFtpObject], *, limit: int, depth: int, max_depth: int) -> None:
        if limit and len(found) >= limit:
            return
        entries = parse_apache_index(self.fetch_text(url), url)
        for entry in entries:
            if limit and len(found) >= limit:
                return
            if entry.is_dir:
                if depth < max_depth:
                    self._walk(spec, entry.url, rel_path + entry.name, found, limit=limit, depth=depth + 1, max_depth=max_depth)
                continue
            found.append(
                PubChemFtpObject(
                    dataset=spec.name,
                    name=entry.name,
                    path=rel_path + entry.name,
                    url=entry.url,
                    size_bytes=entry.size_bytes,
                    last_modified=entry.last_modified,
                    md5_url=entry.md5_url,
                )
            )


class PubChemFtpWorker:
    def __init__(self, store: Any, *, root: Path):
        self.store = store
        self.root = Path(root)

    def run_once(self, *, source: str, worker_id: str, limit: int) -> Dict[str, int]:
        rows = self.store.claim_remote_objects(source=source, worker_id=worker_id, limit=limit)
        report = {"claimed": len(rows), "downloaded": 0, "failed": 0}
        for row in rows:
            object_id = str(row["id"])
            try:
                obj = object_from_metadata(row.get("metadata") or row.get("metadata_json") or {})
                local_path = self.root / "raw" / "pubchem" / obj.path
                sha256 = download_file(obj.url, local_path)
                size_bytes = local_path.stat().st_size
                self.store.mark_remote_object_downloaded(object_id=object_id, local_path=str(local_path), sha256=sha256, size_bytes=size_bytes)
                report["downloaded"] += 1
            except Exception as exc:  # pragma: no cover - defensive per-object boundary
                self.store.mark_remote_object_failed(object_id=object_id, error=str(exc))
                report["failed"] += 1
        return report


def object_from_metadata(metadata: Any) -> PubChemFtpObject:
    if isinstance(metadata, str):
        metadata = json.loads(metadata)
    return PubChemFtpObject(
        dataset=str(metadata.get("dataset") or "unknown"),
        name=str(metadata.get("name") or Path(str(metadata["url"])).name),
        path=str(metadata.get("path") or metadata.get("remote_key") or Path(str(metadata["url"])).name).removeprefix("pubchem/"),
        url=str(metadata["url"]),
        size_bytes=metadata.get("size_bytes"),
        last_modified=str(metadata.get("last_modified") or ""),
        md5_url=str(metadata.get("md5_url") or ""),
    )


def download_file(url: str, target: Path) -> str:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".part")
    digest = hashlib.sha256()
    with urllib.request.urlopen(url) as response, tmp.open("wb") as handle:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            handle.write(chunk)
    tmp.replace(target)
    return digest.hexdigest()


def expand_dataset_names(names: Sequence[str]) -> List[str]:
    if not names or names == ["default"]:
        return list(PUBCHEM_DEFAULT_DATASETS)
    expanded: List[str] = []
    for name in names:
        for item in str(name).split(","):
            item = item.strip()
            if not item:
                continue
            if item == "all":
                expanded.extend(PUBCHEM_FTP_DATASETS)
            elif item == "default":
                expanded.extend(PUBCHEM_DEFAULT_DATASETS)
            elif item in PUBCHEM_FTP_DATASETS:
                expanded.append(item)
            else:
                raise ValueError(f"Unknown PubChem FTP dataset: {item}")
    return list(dict.fromkeys(expanded))


class PostgresPubChemFtpStore:
    def __init__(self, database_url: str):
        self.state = PostgresSyncState(database_url)

    def upsert_remote_objects(self, objects: Iterable[PubChemFtpObject]) -> int:
        count = 0
        with self.state.connect() as conn:
            with conn.cursor() as cur:
                for obj in objects:
                    metadata = obj.metadata()
                    cur.execute(
                        """
                        INSERT INTO chemlake.remote_objects(source, status, last_seen_at, metadata)
                        SELECT 'pubchem', 'planned', NOW(), %s::jsonb
                        WHERE NOT EXISTS (
                            SELECT 1 FROM chemlake.remote_objects
                            WHERE source = 'pubchem'
                              AND COALESCE(metadata->>'url', '') = %s
                        )
                        """,
                        (json.dumps(metadata, sort_keys=True), obj.url),
                    )
                    if cur.rowcount:
                        count += int(cur.rowcount)
                    cur.execute(
                        """
                        UPDATE chemlake.remote_objects
                        SET last_seen_at = NOW(),
                            metadata = metadata || %s::jsonb
                        WHERE source = 'pubchem'
                          AND COALESCE(metadata->>'url', '') = %s
                        """,
                        (json.dumps(metadata, sort_keys=True), obj.url),
                    )
            conn.commit()
        return count

    def claim_remote_objects(self, *, source: str, worker_id: str, limit: int) -> List[Dict[str, Any]]:
        with self.state.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("BEGIN")
                cur.execute(
                    """
                    WITH claimed AS (
                        SELECT id
                        FROM chemlake.remote_objects
                        WHERE source = %s
                          AND status = 'planned'
                        ORDER BY last_seen_at ASC, id ASC
                        LIMIT %s
                        FOR UPDATE SKIP LOCKED
                    )
                    UPDATE chemlake.remote_objects ro
                    SET status = 'claimed',
                        last_seen_at = NOW(),
                        metadata = jsonb_set(
                            jsonb_set(ro.metadata, '{orchestration,worker_id}', to_jsonb(%s::text), true),
                            '{orchestration,claimed_at}', to_jsonb(NOW()::text), true
                        )
                    FROM claimed
                    WHERE ro.id = claimed.id
                    RETURNING ro.id, ro.metadata
                    """,
                    (source, int(limit), worker_id),
                )
                rows = [dict(row) for row in cur.fetchall()]
            conn.commit()
        return rows

    def mark_remote_object_downloaded(self, *, object_id: str, local_path: str, sha256: str, size_bytes: int) -> None:
        with self.state.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO chemlake.blob_store(sha256, size_bytes, updated_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (sha256) DO UPDATE SET
                        size_bytes = EXCLUDED.size_bytes,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (sha256, int(size_bytes)),
                )
                cur.execute(
                    """
                    UPDATE chemlake.remote_objects
                    SET status = 'downloaded',
                        blob_sha256 = %s,
                        last_seen_at = NOW(),
                        metadata = jsonb_set(metadata || %s::jsonb, '{orchestration,downloaded_at}', to_jsonb(NOW()::text), true)
                    WHERE id = %s
                    """,
                    (sha256, json.dumps({"local_path": local_path, "size_bytes": size_bytes}, sort_keys=True), object_id),
                )
            conn.commit()

    def mark_remote_object_failed(self, *, object_id: str, error: str) -> None:
        with self.state.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE chemlake.remote_objects
                    SET status = 'planned',
                        last_seen_at = NOW(),
                        metadata = jsonb_set(metadata, '{orchestration,last_error}', to_jsonb(%s::text), true)
                    WHERE id = %s
                    """,
                    (error[:1000], object_id),
                )
            conn.commit()
