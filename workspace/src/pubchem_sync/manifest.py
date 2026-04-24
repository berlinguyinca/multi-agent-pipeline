"""SQLite manifest tracking synchronized PubChem datasets."""
from __future__ import annotations
import sqlite3
from pathlib import Path
from typing import Iterable

_SCHEMA = """
CREATE TABLE IF NOT EXISTS datasets (
    name       TEXT PRIMARY KEY,
    version    TEXT,
    checksum   TEXT,
    status     TEXT NOT NULL DEFAULT 'pending',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""

class Manifest:
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def record_dataset(self, name: str, version: str, checksum: str) -> None:
        self._conn.execute(
            "INSERT INTO datasets(name, version, checksum, status) VALUES(?,?,?, 'pending') "
            "ON CONFLICT(name) DO UPDATE SET version=excluded.version, "
            "checksum=excluded.checksum, updated_at=CURRENT_TIMESTAMP",
            (name, version, checksum),
        )
        self._conn.commit()

    def mark_status(self, name: str, status: str) -> None:
        self._conn.execute(
            "UPDATE datasets SET status=?, updated_at=CURRENT_TIMESTAMP WHERE name=?",
            (status, name),
        )
        self._conn.commit()

    def list_datasets(self):
        rows = self._conn.execute("SELECT * FROM datasets ORDER BY name").fetchall()
        return [dict(r) for r in rows]

    def find_orphans(self, remote: Iterable[str]):
        remote_set = set(remote)
        local = {r["name"] for r in self.list_datasets()}
        return sorted(local - remote_set)

    def remove(self, name: str) -> None:
        self._conn.execute("DELETE FROM datasets WHERE name=?", (name,))
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()
