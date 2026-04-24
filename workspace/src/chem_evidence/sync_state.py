"""Operational synchronization state for Chemlake mirrors.

The sync-state database tracks source definitions, pending accessions,
attempt/retry state, and local mirror object metadata. Raw payloads and
normalized scientific outputs remain on the filesystem/DuckDB/Parquet; this
module stores only operational state needed to coordinate downloads.
"""
from __future__ import annotations

import csv
import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Union
from urllib.parse import quote, urlparse, urlsplit, urlunsplit

SQLITE_DEFAULT_RELATIVE_PATH = Path("work/state/chemlake-sync.sqlite")
POSTGRES_DEFAULT_HOST = "172.27.108.100"
POSTGRES_DEFAULT_PORT = "6432"
POSTGRES_DEFAULT_DB = "chemlake"

SCHEMA_TABLES = (
    "sources",
    "source_endpoints",
    "accessions",
    "mirror_objects",
    "sync_runs",
    "sync_attempts",
    "normalization_runs",
    "governance",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass(frozen=True)
class SyncStateConfig:
    backend: str
    database_url: str
    sqlite_path: Optional[Path] = None

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "SyncStateConfig":
        if env is None:
            env = os.environ
        backend = env.get("CHEMLAKE_DB_BACKEND", "sqlite").strip().lower() or "sqlite"
        if backend == "sqlite":
            sqlite_path = _sqlite_path_from_env(env)
            return cls(backend="sqlite", database_url=f"sqlite:///{sqlite_path}", sqlite_path=sqlite_path)
        if backend == "postgres":
            return cls(backend="postgres", database_url=build_postgres_url(env))
        raise ValueError(f"Unsupported CHEMLAKE_DB_BACKEND: {backend}")


def _sqlite_path_from_env(env: Mapping[str, str]) -> Path:
    if env.get("CHEMLAKE_SQLITE_PATH"):
        return Path(env["CHEMLAKE_SQLITE_PATH"]).expanduser()
    root = Path(env.get("CHEMLAKE_ROOT", os.getcwd())).expanduser()
    return root / SQLITE_DEFAULT_RELATIVE_PATH


def build_postgres_url(env: Optional[Mapping[str, str]] = None) -> str:
    if env is None:
        env = os.environ
    host = env.get("CHEMLAKE_POSTGRES_HOST", POSTGRES_DEFAULT_HOST).strip() or POSTGRES_DEFAULT_HOST
    port = env.get("CHEMLAKE_POSTGRES_PORT", POSTGRES_DEFAULT_PORT).strip() or POSTGRES_DEFAULT_PORT
    database = env.get("CHEMLAKE_POSTGRES_DB", POSTGRES_DEFAULT_DB).strip() or POSTGRES_DEFAULT_DB
    user = env.get("CHEMLAKE_POSTGRES_USER", "").strip()
    password_env = env.get("CHEMLAKE_POSTGRES_PASSWORD_ENV", "CHEMLAKE_POSTGRES_PASSWORD").strip() or "CHEMLAKE_POSTGRES_PASSWORD"
    password = env.get(password_env, "")
    missing = []
    if not user:
        missing.append("CHEMLAKE_POSTGRES_USER")
    if not password:
        missing.append(password_env)
    if missing:
        raise ValueError("Missing required Postgres sync-state credential env vars: " + ", ".join(missing))
    return "postgresql://{}:{}@{}:{}/{}".format(
        quote(user, safe=""),
        quote(password, safe=""),
        host,
        port,
        quote(database, safe=""),
    )


def display_database_url(database_url: str) -> str:
    """Return a safe-to-print database URL with any Postgres password redacted."""
    parsed = urlsplit(database_url)
    if parsed.scheme not in {"postgres", "postgresql"} or "@" not in parsed.netloc:
        return database_url
    auth, host = parsed.netloc.rsplit("@", 1)
    if ":" not in auth:
        return database_url
    user, _password = auth.split(":", 1)
    return urlunsplit((parsed.scheme, f"{user}:***@{host}", parsed.path, parsed.query, parsed.fragment))


def connect_sync_state(config: Optional[SyncStateConfig] = None):
    config = config or SyncStateConfig.from_env()
    if config.backend == "sqlite":
        if config.sqlite_path is not None:
            return SQLiteSyncState(config.sqlite_path)
        return SQLiteSyncState.from_url(config.database_url)
    if config.backend == "postgres":
        return PostgresSyncState(config.database_url)
    raise ValueError(f"Unsupported sync-state backend: {config.backend}")


class SQLiteSyncState:
    backend = "sqlite"

    def __init__(self, path: Union[Path, str]):
        self.path = Path(path).expanduser()

    @classmethod
    def from_url(cls, database_url: str) -> "SQLiteSyncState":
        parsed = urlparse(database_url)
        if parsed.scheme != "sqlite":
            raise ValueError(f"Not a SQLite URL: {database_url}")
        return cls(Path(parsed.path))

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.path}"

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def init_schema(self) -> Dict[str, Any]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            for statement in SQLITE_SCHEMA:
                conn.execute(statement)
            conn.execute(
                "INSERT OR REPLACE INTO governance(key, value, updated_at) VALUES (?, ?, ?)",
                ("schema_version", "1", utc_now()),
            )
        return {"backend": self.backend, "database_url": display_database_url(self.database_url), "tables": list(SCHEMA_TABLES)}

    def upsert_source(self, row: Mapping[str, Any]) -> str:
        source = str(row["source"]).strip()
        if not source:
            raise ValueError("source is required")
        now = utc_now()
        enabled = _truthy(row.get("enabled", True))
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO sources(source, mode, enabled, job, memory, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source) DO UPDATE SET
                    mode=excluded.mode,
                    enabled=excluded.enabled,
                    job=excluded.job,
                    memory=excluded.memory,
                    notes=excluded.notes,
                    updated_at=excluded.updated_at
                """,
                (
                    source,
                    _clean_optional(row.get("mode")),
                    1 if enabled else 0,
                    _clean_optional(row.get("job")),
                    _clean_optional(row.get("memory")),
                    _clean_optional(row.get("notes")),
                    now,
                    now,
                ),
            )
        return source

    def list_sources(self) -> List[Dict[str, Any]]:
        with self.connect() as conn:
            return [_dict(row) for row in conn.execute("SELECT * FROM sources ORDER BY source")]

    def upsert_accession(
        self,
        source: str,
        accession: str,
        *,
        url: Optional[str] = None,
        priority: int = 0,
        metadata: Optional[Mapping[str, Any]] = None,
    ) -> int:
        source = source.strip()
        accession = accession.strip()
        if not source or not accession:
            raise ValueError("source and accession are required")
        now = utc_now()
        metadata_json = json.dumps(metadata or {}, sort_keys=True, separators=(",", ":"))
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO accessions(source, accession, url, status, priority, attempt_count, metadata_json, created_at, updated_at)
                VALUES (?, ?, ?, 'pending', ?, 0, ?, ?, ?)
                ON CONFLICT(source, accession) DO UPDATE SET
                    url=COALESCE(excluded.url, accessions.url),
                    priority=excluded.priority,
                    metadata_json=excluded.metadata_json,
                    updated_at=excluded.updated_at
                """,
                (source, accession, url, priority, metadata_json, now, now),
            )
            row = conn.execute("SELECT id FROM accessions WHERE source=? AND accession=?", (source, accession)).fetchone()
        return int(row["id"])

    def get_accession(self, source: str, accession: str) -> Optional[Dict[str, Any]]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM accessions WHERE source=? AND accession=?", (source, accession)).fetchone()
        return _dict(row) if row else None

    def claim_pending(self, source: str, *, limit: int = 100, worker_id: Optional[str] = None) -> List[Dict[str, Any]]:
        now = utc_now()
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            rows = [
                _dict(row)
                for row in conn.execute(
                    """
                    SELECT * FROM accessions
                    WHERE source=?
                      AND status IN ('pending', 'retry')
                      AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
                    ORDER BY priority DESC, updated_at ASC, id ASC
                    LIMIT ?
                    """,
                    (source, now, int(limit)),
                )
            ]
            for row in rows:
                conn.execute(
                    "UPDATE accessions SET status='in_progress', worker_id=?, updated_at=? WHERE id=?",
                    (worker_id, now, row["id"]),
                )
                conn.execute(
                    """
                    INSERT INTO sync_attempts(accession_id, status, worker_id, started_at, updated_at)
                    VALUES (?, 'in_progress', ?, ?, ?)
                    """,
                    (row["id"], worker_id, now, now),
                )
            conn.commit()
        for row in rows:
            row["status"] = "in_progress"
            row["worker_id"] = worker_id
        return rows

    def mark_failed(self, source: str, accession: str, error: str, *, next_attempt_at: Optional[str] = None) -> Dict[str, Any]:
        now = utc_now()
        with self.connect() as conn:
            conn.execute(
                """
                UPDATE accessions
                SET status='retry', attempt_count=attempt_count + 1, last_error=?, next_attempt_at=?, updated_at=?
                WHERE source=? AND accession=?
                """,
                (error, next_attempt_at, now, source, accession),
            )
            row = conn.execute("SELECT id FROM accessions WHERE source=? AND accession=?", (source, accession)).fetchone()
            if not row:
                raise KeyError(f"Unknown accession: {source}/{accession}")
            conn.execute(
                """
                UPDATE sync_attempts
                SET status='failed', error=?, finished_at=?, updated_at=?
                WHERE accession_id=? AND status='in_progress'
                """,
                (error, now, now, row["id"]),
            )
        result = self.get_accession(source, accession)
        if result is None:
            raise KeyError(f"Unknown accession: {source}/{accession}")
        return result

    def mark_downloaded(
        self,
        source: str,
        accession: str,
        *,
        local_path: str,
        sha256: Optional[str] = None,
        size_bytes: Optional[int] = None,
    ) -> Dict[str, Any]:
        now = utc_now()
        with self.connect() as conn:
            row = conn.execute("SELECT id FROM accessions WHERE source=? AND accession=?", (source, accession)).fetchone()
            if not row:
                raise KeyError(f"Unknown accession: {source}/{accession}")
            accession_id = int(row["id"])
            conn.execute(
                """
                UPDATE accessions
                SET status='downloaded', local_path=?, sha256=?, size_bytes=?, downloaded_at=?, updated_at=?
                WHERE id=?
                """,
                (local_path, sha256, size_bytes, now, now, accession_id),
            )
            conn.execute(
                """
                INSERT INTO mirror_objects(accession_id, source, accession, local_path, sha256, size_bytes, status, downloaded_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'downloaded', ?, ?, ?)
                ON CONFLICT(accession_id, local_path) DO UPDATE SET
                    sha256=excluded.sha256,
                    size_bytes=excluded.size_bytes,
                    status=excluded.status,
                    downloaded_at=excluded.downloaded_at,
                    updated_at=excluded.updated_at
                """,
                (accession_id, source, accession, local_path, sha256, size_bytes, now, now, now),
            )
            conn.execute(
                """
                UPDATE sync_attempts
                SET status='downloaded', finished_at=?, updated_at=?
                WHERE accession_id=? AND status='in_progress'
                """,
                (now, now, accession_id),
            )
        result = self.get_accession(source, accession)
        if result is None:
            raise KeyError(f"Unknown accession: {source}/{accession}")
        return result

    def status(self) -> Dict[str, Any]:
        with self.connect() as conn:
            sources = conn.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
            accessions = conn.execute("SELECT COUNT(*) FROM accessions").fetchone()[0]
            by_status = {
                row["status"]: row["count"]
                for row in conn.execute("SELECT status, COUNT(*) AS count FROM accessions GROUP BY status ORDER BY status")
            }
            attempts = conn.execute("SELECT COUNT(*) FROM sync_attempts").fetchone()[0]
            downloaded = conn.execute("SELECT COUNT(*) FROM mirror_objects WHERE status='downloaded'").fetchone()[0]
        return {
            "backend": self.backend,
            "database_url": display_database_url(self.database_url),
            "sources": sources,
            "accessions": accessions,
            "accessions_by_status": by_status,
            "sync_attempts": attempts,
            "mirror_objects_downloaded": downloaded,
        }

    def report(self, snapshot: str) -> Dict[str, Any]:
        result = self.status()
        result["snapshot"] = snapshot
        return result


class PostgresSyncState:
    backend = "postgres"

    def __init__(self, database_url: str):
        self.database_url = database_url

    @staticmethod
    def pending_query(limit: int) -> str:
        return """
            SELECT * FROM accessions
            WHERE source=%s
              AND status IN ('pending', 'retry')
              AND (next_attempt_at IS NULL OR next_attempt_at <= %s)
            ORDER BY priority DESC, updated_at ASC, id ASC
            LIMIT %s
            FOR UPDATE SKIP LOCKED
        """.strip()

    def connect(self):  # pragma: no cover - exercised only when psycopg/Postgres is available
        try:
            import psycopg  # type: ignore
            from psycopg.rows import dict_row  # type: ignore
        except ImportError as exc:  # pragma: no cover - dependency intentionally optional
            raise RuntimeError("Postgres sync state requires the optional psycopg package at runtime") from exc
        return psycopg.connect(self.database_url, row_factory=dict_row)

    def init_schema(self) -> Dict[str, Any]:  # pragma: no cover - no production DB in unit tests
        with self.connect() as conn:
            with conn.cursor() as cur:
                for statement in POSTGRES_SCHEMA:
                    cur.execute(statement)
                cur.execute(
                    """
                    INSERT INTO governance(key, value, updated_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
                    """,
                    ("schema_version", "1"),
                )
            conn.commit()
        return {"backend": self.backend, "database_url": display_database_url(self.database_url), "tables": list(SCHEMA_TABLES)}

    def status(self) -> Dict[str, Any]:  # pragma: no cover - no production DB in unit tests
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) AS count FROM sources")
                sources = cur.fetchone()["count"]
                cur.execute("SELECT COUNT(*) AS count FROM accessions")
                accessions = cur.fetchone()["count"]
                cur.execute("SELECT status, COUNT(*) AS count FROM accessions GROUP BY status ORDER BY status")
                by_status = {row["status"]: row["count"] for row in cur.fetchall()}
        return {
            "backend": self.backend,
            "database_url": display_database_url(self.database_url),
            "sources": sources,
            "accessions": accessions,
            "accessions_by_status": by_status,
        }

    def upsert_source(self, row: Mapping[str, Any]) -> str:  # pragma: no cover - no production DB in unit tests
        source = str(row["source"]).strip()
        if not source:
            raise ValueError("source is required")
        now = utc_now()
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO sources(source, mode, enabled, job, memory, notes, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT(source) DO UPDATE SET
                        mode=excluded.mode,
                        enabled=excluded.enabled,
                        job=excluded.job,
                        memory=excluded.memory,
                        notes=excluded.notes,
                        updated_at=excluded.updated_at
                    """,
                    (
                        source,
                        _clean_optional(row.get("mode")),
                        _truthy(row.get("enabled", True)),
                        _clean_optional(row.get("job")),
                        _clean_optional(row.get("memory")),
                        _clean_optional(row.get("notes")),
                        now,
                        now,
                    ),
                )
            conn.commit()
        return source

    def list_sources(self) -> List[Dict[str, Any]]:  # pragma: no cover - no production DB in unit tests
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM sources ORDER BY source")
                return [dict(row) for row in cur.fetchall()]

    def upsert_accession(
        self,
        source: str,
        accession: str,
        *,
        url: Optional[str] = None,
        priority: int = 0,
        metadata: Optional[Mapping[str, Any]] = None,
    ) -> int:  # pragma: no cover - no production DB in unit tests
        source = source.strip()
        accession = accession.strip()
        if not source or not accession:
            raise ValueError("source and accession are required")
        now = utc_now()
        metadata_json = json.dumps(metadata or {}, sort_keys=True, separators=(",", ":"))
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO accessions(source, accession, url, status, priority, attempt_count, metadata_json, created_at, updated_at)
                    VALUES (%s, %s, %s, 'pending', %s, 0, %s, %s, %s)
                    ON CONFLICT(source, accession) DO UPDATE SET
                        url=COALESCE(excluded.url, accessions.url),
                        priority=excluded.priority,
                        metadata_json=excluded.metadata_json,
                        updated_at=excluded.updated_at
                    RETURNING id
                    """,
                    (source, accession, url, priority, metadata_json, now, now),
                )
                row = cur.fetchone()
            conn.commit()
        return int(row["id"])

    def get_accession(self, source: str, accession: str) -> Optional[Dict[str, Any]]:  # pragma: no cover
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM accessions WHERE source=%s AND accession=%s", (source, accession))
                row = cur.fetchone()
        return dict(row) if row else None

    def claim_pending(
        self, source: str, *, limit: int = 100, worker_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:  # pragma: no cover - no production DB in unit tests
        now = utc_now()
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("BEGIN")
                cur.execute(self.pending_query(limit), (source, now, int(limit)))
                rows = [dict(row) for row in cur.fetchall()]
                for row in rows:
                    cur.execute("UPDATE accessions SET status='in_progress', worker_id=%s, updated_at=%s WHERE id=%s", (worker_id, now, row["id"]))
                    cur.execute(
                        """
                        INSERT INTO sync_attempts(accession_id, status, worker_id, started_at, updated_at)
                        VALUES (%s, 'in_progress', %s, %s, %s)
                        """,
                        (row["id"], worker_id, now, now),
                    )
            conn.commit()
        for row in rows:
            row["status"] = "in_progress"
            row["worker_id"] = worker_id
        return rows

    def mark_failed(
        self, source: str, accession: str, error: str, *, next_attempt_at: Optional[str] = None
    ) -> Dict[str, Any]:  # pragma: no cover - no production DB in unit tests
        now = utc_now()
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE accessions
                    SET status='retry', attempt_count=attempt_count + 1, last_error=%s, next_attempt_at=%s, updated_at=%s
                    WHERE source=%s AND accession=%s
                    RETURNING id
                    """,
                    (error, next_attempt_at, now, source, accession),
                )
                row = cur.fetchone()
                if not row:
                    raise KeyError(f"Unknown accession: {source}/{accession}")
                cur.execute(
                    """
                    UPDATE sync_attempts
                    SET status='failed', error=%s, finished_at=%s, updated_at=%s
                    WHERE accession_id=%s AND status='in_progress'
                    """,
                    (error, now, now, row["id"]),
                )
            conn.commit()
        result = self.get_accession(source, accession)
        if result is None:
            raise KeyError(f"Unknown accession: {source}/{accession}")
        return result

    def mark_downloaded(
        self,
        source: str,
        accession: str,
        *,
        local_path: str,
        sha256: Optional[str] = None,
        size_bytes: Optional[int] = None,
    ) -> Dict[str, Any]:  # pragma: no cover - no production DB in unit tests
        now = utc_now()
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM accessions WHERE source=%s AND accession=%s", (source, accession))
                row = cur.fetchone()
                if not row:
                    raise KeyError(f"Unknown accession: {source}/{accession}")
                accession_id = int(row["id"])
                cur.execute(
                    """
                    UPDATE accessions
                    SET status='downloaded', local_path=%s, sha256=%s, size_bytes=%s, downloaded_at=%s, updated_at=%s
                    WHERE id=%s
                    """,
                    (local_path, sha256, size_bytes, now, now, accession_id),
                )
                cur.execute(
                    """
                    INSERT INTO mirror_objects(accession_id, source, accession, local_path, sha256, size_bytes, status, downloaded_at, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, 'downloaded', %s, %s, %s)
                    ON CONFLICT(accession_id, local_path) DO UPDATE SET
                        sha256=excluded.sha256,
                        size_bytes=excluded.size_bytes,
                        status=excluded.status,
                        downloaded_at=excluded.downloaded_at,
                        updated_at=excluded.updated_at
                    """,
                    (accession_id, source, accession, local_path, sha256, size_bytes, now, now, now),
                )
                cur.execute(
                    """
                    UPDATE sync_attempts
                    SET status='downloaded', finished_at=%s, updated_at=%s
                    WHERE accession_id=%s AND status='in_progress'
                    """,
                    (now, now, accession_id),
                )
            conn.commit()
        result = self.get_accession(source, accession)
        if result is None:
            raise KeyError(f"Unknown accession: {source}/{accession}")
        return result

    def report(self, snapshot: str) -> Dict[str, Any]:  # pragma: no cover - no production DB in unit tests
        result = self.status()
        result["snapshot"] = snapshot
        return result


def import_sources_tsv(state: Union[SQLiteSyncState, PostgresSyncState], path: Union[Path, str]) -> Dict[str, Any]:
    path = Path(path)
    imported = 0
    skipped = 0
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        for row in reader:
            clean = {str(key).strip(): (value.strip() if isinstance(value, str) else value) for key, value in row.items() if key is not None}
            if not clean.get("source"):
                skipped += 1
                continue
            state.upsert_source(clean)
            imported += 1
    return {"imported": imported, "skipped": skipped, "path": str(path)}


def _dict(row: sqlite3.Row) -> Dict[str, Any]:
    result = dict(row)
    if "enabled" in result:
        result["enabled"] = bool(result["enabled"])
    return result


def _clean_optional(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "y", "enabled"}


SQLITE_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS sources (
        source TEXT PRIMARY KEY,
        mode TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        job TEXT,
        memory TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS source_endpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL REFERENCES sources(source) ON DELETE CASCADE,
        endpoint_type TEXT,
        url TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source, endpoint_type, url)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS accessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL REFERENCES sources(source) ON DELETE CASCADE,
        accession TEXT NOT NULL,
        url TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 0,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        worker_id TEXT,
        last_error TEXT,
        next_attempt_at TEXT,
        local_path TEXT,
        sha256 TEXT,
        size_bytes INTEGER,
        downloaded_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source, accession)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_accessions_pending ON accessions(source, status, priority, updated_at)",
    """
    CREATE TABLE IF NOT EXISTS mirror_objects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        accession_id INTEGER NOT NULL REFERENCES accessions(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        accession TEXT NOT NULL,
        local_path TEXT NOT NULL,
        sha256 TEXT,
        size_bytes INTEGER,
        status TEXT NOT NULL,
        downloaded_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(accession_id, local_path)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sync_runs (
        id TEXT PRIMARY KEY,
        source TEXT,
        snapshot TEXT,
        backend TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        message TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sync_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        accession_id INTEGER NOT NULL REFERENCES accessions(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES sync_runs(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        error TEXT,
        worker_id TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS normalization_runs (
        id TEXT PRIMARY KEY,
        source TEXT,
        snapshot TEXT,
        status TEXT NOT NULL,
        input_path TEXT,
        output_path TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        message TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS governance (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
]

POSTGRES_SCHEMA = [statement.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "BIGSERIAL PRIMARY KEY").replace("INTEGER NOT NULL DEFAULT 1", "BOOLEAN NOT NULL DEFAULT TRUE") for statement in SQLITE_SCHEMA]
