import json
import os
import sqlite3
import subprocess
from pathlib import Path

import pytest

from chem_evidence.cli import main
from chem_evidence.sync_state import (
    PostgresSyncState,
    SQLiteSyncState,
    SyncStateConfig,
    display_database_url,
    import_sources_tsv,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCES_TSV = REPO_ROOT / "slurm" / "sources.tsv"
COMMON_SH = REPO_ROOT / "slurm" / "lib" / "common.sh"


def test_sqlite_initializes_schema_imports_trimmed_sources_and_uses_wal(tmp_path):
    db_path = tmp_path / "state" / "chemlake-sync.sqlite"
    state = SQLiteSyncState(db_path)
    state.init_schema()

    imported = import_sources_tsv(state, SOURCES_TSV)
    assert imported["imported"] >= 20
    sources = {row["source"]: row for row in state.list_sources()}
    assert "t3db" in sources
    assert " t3db" not in sources
    assert sources["t3db"]["mode"] == "raw_fetch"

    with sqlite3.connect(db_path) as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
        table_names = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {
        "sources",
        "source_endpoints",
        "accessions",
        "mirror_objects",
        "sync_runs",
        "sync_attempts",
        "normalization_runs",
        "governance",
    }.issubset(table_names)


def test_sqlite_accessions_pending_download_and_retry_state_are_idempotent(tmp_path):
    state = SQLiteSyncState(tmp_path / "sync.sqlite")
    state.init_schema()
    state.upsert_source({"source": "pubchem", "mode": "mirror_transform", "enabled": True})
    first = state.upsert_accession("pubchem", "CID:2244", url="https://example.test/2244.json")
    second = state.upsert_accession("pubchem", "CID:2244", url="https://example.test/2244.json")
    assert first == second

    pending = state.claim_pending("pubchem", limit=5, worker_id="worker-a")
    assert [row["accession"] for row in pending] == ["CID:2244"]
    assert state.claim_pending("pubchem", limit=5, worker_id="worker-b") == []

    state.mark_failed("pubchem", "CID:2244", "temporary 503")
    retry_row = state.get_accession("pubchem", "CID:2244")
    assert retry_row["status"] == "retry"
    assert retry_row["attempt_count"] == 1
    assert retry_row["last_error"] == "temporary 503"

    pending_again = state.claim_pending("pubchem", limit=5, worker_id="worker-c")
    assert [row["accession"] for row in pending_again] == ["CID:2244"]
    state.mark_downloaded(
        "pubchem",
        "CID:2244",
        local_path="raw/pubchem/CID2244.json",
        sha256="abc123",
        size_bytes=42,
    )
    downloaded = state.get_accession("pubchem", "CID:2244")
    assert downloaded["status"] == "downloaded"
    assert downloaded["local_path"] == "raw/pubchem/CID2244.json"
    assert downloaded["sha256"] == "abc123"
    assert downloaded["size_bytes"] == 42


def test_postgres_config_builds_hive_url_from_env_without_persisting_credentials(monkeypatch):
    monkeypatch.setenv("CHEMLAKE_DB_BACKEND", "postgres")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_HOST", "172.27.108.100")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_PORT", "6432")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_DB", "chemlake")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_USER", "chemlake_worker")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_PASSWORD_ENV", "CHEMLAKE_POSTGRES_PASSWORD")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_PASSWORD", "secret")

    config = SyncStateConfig.from_env()

    assert config.backend == "postgres"
    assert config.database_url == "postgresql://chemlake_worker:secret@172.27.108.100:6432/chemlake"
    assert os.environ["CHEMLAKE_POSTGRES_PASSWORD_ENV"] == "CHEMLAKE_POSTGRES_PASSWORD"


def test_display_database_url_redacts_postgres_password():
    display = display_database_url("postgresql://worker:secret@172.27.108.100:6432/chemlake")
    assert display == "postgresql://worker:***@172.27.108.100:6432/chemlake"
    assert "secret" not in display


def test_postgres_requires_credentials_and_pending_query_uses_skip_locked(monkeypatch):
    monkeypatch.setenv("CHEMLAKE_DB_BACKEND", "postgres")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_USER", "chemlake_worker")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_PASSWORD_ENV", "CHEMLAKE_POSTGRES_PASSWORD")
    monkeypatch.delenv("CHEMLAKE_POSTGRES_PASSWORD", raising=False)

    with pytest.raises(ValueError, match="CHEMLAKE_POSTGRES_PASSWORD"):
        SyncStateConfig.from_env()

    query = PostgresSyncState.pending_query(limit=10)
    assert "FOR UPDATE SKIP LOCKED" in query
    assert "LIMIT %s" in query


def test_chemlake_sync_state_and_sync_cli_commands(tmp_path, capsys, monkeypatch):
    db_path = tmp_path / "sync.sqlite"
    monkeypatch.setenv("CHEMLAKE_DB_BACKEND", "sqlite")
    monkeypatch.setenv("CHEMLAKE_SQLITE_PATH", str(db_path))

    assert main(["sync-state", "init"]) == 0
    assert json.loads(capsys.readouterr().out)["backend"] == "sqlite"

    assert main(["sources", "import", "--from", str(SOURCES_TSV)]) == 0
    imported = json.loads(capsys.readouterr().out)
    assert imported["imported"] >= 20

    state = SQLiteSyncState(db_path)
    state.upsert_accession("pubchem", "CID:2244", url="https://example.test/2244.json")

    assert main(["sync", "pending", "--source", "pubchem", "--limit", "1"]) == 0
    pending = json.loads(capsys.readouterr().out)
    assert pending["pending"][0]["accession"] == "CID:2244"

    assert main([
        "sync",
        "mark-downloaded",
        "--source",
        "pubchem",
        "--accession",
        "CID:2244",
        "--local-path",
        "raw/pubchem/CID2244.json",
        "--sha256",
        "abc123",
        "--size-bytes",
        "42",
    ]) == 0
    marked = json.loads(capsys.readouterr().out)
    assert marked["status"] == "downloaded"

    assert main(["sync-state", "status"]) == 0
    status = json.loads(capsys.readouterr().out)
    assert status["accessions_by_status"]["downloaded"] == 1

    assert main(["sync", "report", "--snapshot", "2026-04-22"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["snapshot"] == "2026-04-22"
    assert report["sources"] >= 20


def test_slurm_common_resolves_postgres_and_sqlite_database_urls(tmp_path):
    env = os.environ.copy()
    env.update(
        {
            "CHEMLAKE_ROOT": str(tmp_path / "chemlake"),
            "CHEMLAKE_POSTGRES_USER": "chemlake_worker",
            "CHEMLAKE_POSTGRES_PASSWORD": "secret",
            "CHEMLAKE_POSTGRES_PASSWORD_ENV": "CHEMLAKE_POSTGRES_PASSWORD",
        }
    )
    command = f'source "{COMMON_SH}" >/dev/null && printf "%s" "$CHEMLAKE_DATABASE_URL"'
    postgres = subprocess.run(["bash", "-lc", command], env=env, check=True, text=True, capture_output=True).stdout
    assert postgres == "postgresql://chemlake_worker:secret@172.27.108.100:6432/chemlake"

    env["CHEMLAKE_DB_BACKEND"] = "sqlite"
    sqlite_url = subprocess.run(["bash", "-lc", command], env=env, check=True, text=True, capture_output=True).stdout
    assert sqlite_url == f"sqlite:///{tmp_path / 'chemlake' / 'work' / 'state' / 'chemlake-sync.sqlite'}"


def test_slurm_common_fails_fast_when_postgres_credentials_are_missing(tmp_path):
    env = os.environ.copy()
    env.update({"CHEMLAKE_ROOT": str(tmp_path / "chemlake"), "CHEMLAKE_DB_BACKEND": "postgres"})
    env.pop("CHEMLAKE_POSTGRES_USER", None)
    env.pop("CHEMLAKE_POSTGRES_PASSWORD", None)
    result = subprocess.run(
        ["bash", "-lc", f'source "{COMMON_SH}"'],
        env=env,
        text=True,
        capture_output=True,
    )
    assert result.returncode != 0
    assert "CHEMLAKE_POSTGRES_USER" in result.stderr


def test_slurm_common_blocks_worker_runtime_without_orchestrator_context(tmp_path):
    env = os.environ.copy()
    env.update(
        {
            "CHEMLAKE_ROOT": str(tmp_path / "chemlake"),
            "CHEMLAKE_DB_BACKEND": "postgres",
            "CHEMLAKE_POSTGRES_USER": "chemlake_worker",
            "CHEMLAKE_POSTGRES_PASSWORD": "secret",
            "CHEMLAKE_POSTGRES_PASSWORD_ENV": "CHEMLAKE_POSTGRES_PASSWORD",
            "CHEM_EVIDENCE_SETUP": "",
            "UV_BIN": "uv",
        }
    )
    command = f'source "{COMMON_SH}" >/dev/null && setup_runtime'

    result = subprocess.run(["bash", "-lc", command], env=env, text=True, capture_output=True)

    assert result.returncode != 0
    assert "CHEMLAKE_ORCHESTRATOR_RUN_ID" in result.stderr
