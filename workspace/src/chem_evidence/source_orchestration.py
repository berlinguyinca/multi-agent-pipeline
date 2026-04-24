"""Generic orchestration work planning for non-PubChem Chemlake sources."""
from __future__ import annotations

import hashlib
import json
import os
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Sequence

from .source_adapters import SOURCE_ADAPTERS, SourceAdapterStatus, load_source_paths_config
from .sync_state import PostgresSyncState


@dataclass(frozen=True, init=False)
class SourceWorkItem:
    source: str
    accession: str
    url: str
    mode: str
    job: str
    extra: Dict[str, Any] = field(default_factory=dict)

    def __init__(
        self,
        *,
        source: str,
        accession: str,
        url: str,
        mode: str,
        job: str,
        metadata: Mapping[str, Any] | None = None,
        extra: Mapping[str, Any] | None = None,
    ) -> None:
        object.__setattr__(self, "source", source)
        object.__setattr__(self, "accession", accession)
        object.__setattr__(self, "url", url)
        object.__setattr__(self, "mode", mode)
        object.__setattr__(self, "job", job)
        payload: Dict[str, Any] = {}
        if extra:
            payload.update(dict(extra))
        if metadata:
            payload.update(dict(metadata))
        object.__setattr__(self, "extra", payload)

    @property
    def remote_key(self) -> str:
        return f"{self.source}/{self.accession}"

    def metadata_payload(self) -> Dict[str, Any]:
        payload = dict(self.extra)
        payload.update(
            {
                "source": self.source,
                "accession": self.accession,
                "url": self.url,
                "mode": self.mode,
                "job": self.job,
                "remote_key": self.remote_key,
                "planner": "source-work",
            }
        )
        return payload

    def metadata(self) -> Dict[str, Any]:
        return self.metadata_payload()


class SourceWorkPlanner:
    def __init__(self, store: Any):
        self.store = store

    def plan(self, *, rows: Iterable[Mapping[str, Any]], sources: Sequence[str], include_pubchem: bool = False) -> Dict[str, Any]:
        selected, blocked = _select_rows(rows, sources=sources, include_pubchem=include_pubchem)
        objects = [_work_item_for_row(row) for row in selected]
        planned = self.store.upsert_remote_objects(objects) if objects else 0
        return {
            "sources": [item.source for item in objects],
            "blocked": blocked,
            "discovered": len(objects),
            "planned": planned,
        }


class SourceWorkWorker:
    def __init__(self, store: Any, *, root: Path):
        self.store = store
        self.root = Path(root)

    def run_once(self, *, source: str, worker_id: str, limit: int) -> Dict[str, int]:
        rows = self.store.claim_remote_objects(source=source, worker_id=worker_id, limit=limit)
        report = {"claimed": len(rows), "downloaded": 0, "failed": 0}
        for row in rows:
            object_id = str(row["id"])
            try:
                item = item_from_metadata(row.get("metadata") or row.get("metadata_json") or {})
                local_path = self.root / "raw" / item.source / _safe_filename(item.accession, item.url)
                sha256 = _copy_or_download(item.url, local_path)
                self.store.mark_remote_object_downloaded(object_id=object_id, local_path=str(local_path), sha256=sha256, size_bytes=local_path.stat().st_size)
                report["downloaded"] += 1
            except Exception as exc:  # pragma: no cover - defensive per-object boundary
                self.store.mark_remote_object_failed(object_id=object_id, error=str(exc))
                report["failed"] += 1
        return report


def item_from_metadata(metadata: Any) -> SourceWorkItem:
    if isinstance(metadata, str):
        metadata = json.loads(metadata)
    return SourceWorkItem(
        source=str(metadata["source"]),
        accession=str(metadata["accession"]),
        url=str(metadata.get("url") or ""),
        mode=str(metadata.get("mode") or "raw_fetch"),
        job=str(metadata.get("job") or "raw_fetch_scaffold"),
        metadata={key: value for key, value in dict(metadata).items() if key not in {"source", "accession", "url", "mode", "job"}},
    )


def _select_rows(rows: Iterable[Mapping[str, Any]], *, sources: Sequence[str], include_pubchem: bool) -> tuple[List[Mapping[str, Any]], List[Dict[str, str]]]:
    wanted = _expand_sources(sources)
    selected = []
    blocked = []
    configured_paths = load_source_paths_config()
    for row in rows:
        source = str(row.get("source") or "").strip()
        if not source or not _truthy(row.get("enabled")):
            continue
        if source == "pubchem" and not include_pubchem:
            continue
        adapter = SOURCE_ADAPTERS.get(source)
        if adapter is None or adapter.status is SourceAdapterStatus.EXCLUDED:
            continue
        if wanted != {"all"} and source not in wanted:
            continue
        if adapter.status is SourceAdapterStatus.LOCAL_FILE and not _configured_local_path(adapter, configured_paths):
            blocked.append(
                {
                    "source": source,
                    "env_var": adapter.env_path_var,
                    "reason": adapter.live_blocker or f"requires {adapter.env_path_var or 'local path'}",
                }
            )
            continue
        selected.append(row)
    return selected, blocked


def _expand_sources(sources: Sequence[str]) -> set:
    if not sources:
        return {"all"}
    result = set()
    for raw in sources:
        for item in str(raw).split(","):
            item = item.strip()
            if item:
                result.add(item)
    return result or {"all"}


def _work_item_for_row(row: Mapping[str, Any]) -> SourceWorkItem:
    source = str(row["source"]).strip()
    adapter = SOURCE_ADAPTERS[source]
    url = _source_url(adapter)
    accession = f"{source}:{row.get('mode') or adapter.status.value}"
    return SourceWorkItem(
        source=source,
        accession=accession,
        url=url,
        mode=str(row.get("mode") or "raw_fetch"),
        job=str(row.get("job") or "raw_fetch_scaffold"),
        metadata={"adapter": adapter.name, "notes": row.get("notes") or adapter.notes},
    )


def _source_url(adapter) -> str:
    if adapter.status is SourceAdapterStatus.LOCAL_FILE:
        configured = _configured_local_path(adapter, load_source_paths_config())
        if not configured:
            raise ValueError(f"{adapter.source} requires {adapter.env_path_var or 'local path'} before source work can be planned")
        return configured
    return adapter.live_url or adapter.integration_path


def _configured_local_path(adapter, configured_paths: Mapping[str, str]) -> str:
    if not adapter.env_path_var:
        return ""
    return os.environ.get(adapter.env_path_var) or configured_paths.get(adapter.env_path_var, "")


def _copy_or_download(url: str, target: Path) -> str:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".part")
    digest = hashlib.sha256()
    if url.startswith("file://"):
        source_path = Path(urllib.request.url2pathname(url[7:]))
        with source_path.open("rb") as src, tmp.open("wb") as dst:
            _copy_digest(src, dst, digest)
    elif url and not url.startswith(("http://", "https://", "ftp://", "local://")) and Path(url).exists():
        with Path(url).open("rb") as src, tmp.open("wb") as dst:
            _copy_digest(src, dst, digest)
    elif url.startswith("local://") or not url:
        raise ValueError(f"source work item has no concrete downloadable/local path: {url or '<empty>'}")
    else:
        with urllib.request.urlopen(url) as response, tmp.open("wb") as dst:
            _copy_digest(response, dst, digest)
    tmp.replace(target)
    return digest.hexdigest()


def _copy_digest(src, dst, digest) -> None:
    while True:
        chunk = src.read(1024 * 1024)
        if not chunk:
            break
        digest.update(chunk)
        dst.write(chunk)


def _safe_filename(accession: str, url: str) -> str:
    suffix = Path(url).suffix if url else ".json"
    safe = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in accession)
    return safe if safe.endswith(suffix) else safe + (suffix or ".dat")


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y", "enabled"}


class PostgresSourceWorkStore:
    def __init__(self, database_url: str):
        self.state = PostgresSyncState(database_url)

    def upsert_remote_objects(self, objects: Iterable[SourceWorkItem]) -> int:
        count = 0
        with self.state.connect() as conn:
            with conn.cursor() as cur:
                for item in objects:
                    metadata = item.metadata()
                    cur.execute(
                        """
                        INSERT INTO chemlake.remote_objects(source, status, last_seen_at, metadata)
                        SELECT %s, 'planned', NOW(), %s::jsonb
                        WHERE NOT EXISTS (
                            SELECT 1 FROM chemlake.remote_objects
                            WHERE source = %s
                              AND COALESCE(metadata->>'remote_key', '') = %s
                        )
                        """,
                        (item.source, json.dumps(metadata, sort_keys=True), item.source, item.remote_key),
                    )
                    count += int(cur.rowcount or 0)
                    cur.execute(
                        """
                        UPDATE chemlake.remote_objects
                        SET last_seen_at = NOW(), metadata = metadata || %s::jsonb
                        WHERE source = %s
                          AND COALESCE(metadata->>'remote_key', '') = %s
                        """,
                        (json.dumps(metadata, sort_keys=True), item.source, item.remote_key),
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
                            COALESCE(ro.metadata, '{}'::jsonb) || '{"orchestration": {}}'::jsonb,
                            '{orchestration,worker_id}',
                            to_jsonb(%s::text),
                            true
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
                    ON CONFLICT (sha256) DO UPDATE SET size_bytes = EXCLUDED.size_bytes, updated_at = EXCLUDED.updated_at
                    """,
                    (sha256, int(size_bytes)),
                )
                cur.execute(
                    """
                    UPDATE chemlake.remote_objects
                    SET status = 'downloaded', blob_sha256 = %s, last_seen_at = NOW(), metadata = metadata || %s::jsonb
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
                        metadata = jsonb_set(
                            COALESCE(metadata, '{}'::jsonb) || '{"orchestration": {}}'::jsonb,
                            '{orchestration,last_error}',
                            to_jsonb(%s::text),
                            true
                        )
                    WHERE id = %s
                    """,
                    (error[:1000], object_id),
                )
            conn.commit()
