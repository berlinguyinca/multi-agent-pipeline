import json
import socket
import threading
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from chem_evidence.source_adapters import (
    SOURCE_ADAPTERS,
    SourceAdapterStatus,
    parse_sources_tsv,
    verify_live_adapters,
    verify_registered_adapters,
)
from chem_evidence.cli import main

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCES_TSV = REPO_ROOT / "slurm" / "sources.tsv"


def test_every_registered_source_has_a_declared_adapter_or_explicit_exclusion():
    rows = parse_sources_tsv(SOURCES_TSV)
    report = verify_registered_adapters(rows)

    assert report["missing_adapters"] == []
    assert report["enabled_without_working_adapter"] == []
    assert {"nist", "mzcloud"}.issubset(set(report["excluded_sources"]))
    assert set(SOURCE_ADAPTERS).issuperset({row["source"] for row in rows})


def test_all_enabled_registered_adapters_pass_real_local_http_or_file_integration(tmp_path):
    rows = parse_sources_tsv(SOURCES_TSV)
    enabled_sources = [row["source"] for row in rows if row["enabled"]]
    http_payloads = {
        adapter.integration_path: adapter.integration_payload_bytes()
        for source, adapter in SOURCE_ADAPTERS.items()
        if source in enabled_sources and adapter.status is SourceAdapterStatus.HTTP
    }
    with _fixture_http_server(http_payloads) as base_url:
        for source in enabled_sources:
            adapter = SOURCE_ADAPTERS[source]
            if adapter.status is SourceAdapterStatus.LOCAL_FILE:
                local_file = tmp_path / f"{source}.jsonl"
                local_file.write_bytes(adapter.integration_payload_bytes())
                records = adapter.fetch_records(local_path=local_file, limit=2)
            else:
                records = adapter.fetch_records(base_url=base_url, limit=2)
            assert records, source
            assert records[0].source == source
            assert records[0].accession
            assert records[0].url
            assert records[0].metadata


def test_sources_verify_adapters_cli_reports_complete_coverage_without_database_credentials(capsys, monkeypatch):
    monkeypatch.setenv("CHEMLAKE_DB_BACKEND", "postgres")
    monkeypatch.delenv("CHEMLAKE_POSTGRES_USER", raising=False)
    monkeypatch.delenv("CHEMLAKE_POSTGRES_PASSWORD", raising=False)

    assert main(["sources", "verify-adapters", "--from", str(SOURCES_TSV)]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["missing_adapters"] == []
    assert report["enabled_without_working_adapter"] == []
    assert report["summary"]["enabled_sources"] >= 20


def test_live_adapter_registry_has_real_remote_probe_or_explicit_blocker_for_every_enabled_source(monkeypatch):
    monkeypatch.delenv("HMDB_XML", raising=False)
    monkeypatch.delenv("DRUGBANK_INPUT", raising=False)
    monkeypatch.delenv("T3DB_INPUT", raising=False)
    monkeypatch.delenv("CAS_COMMON_CHEMISTRY_API_URL", raising=False)
    monkeypatch.setenv("CHEMLAKE_SOURCE_CONFIG", "/missing/source-paths.env")

    rows = parse_sources_tsv(SOURCES_TSV)
    enabled_sources = [row["source"] for row in rows if row["enabled"]]
    http_payloads = {
        adapter.integration_path: adapter.integration_payload_bytes()
        for source, adapter in SOURCE_ADAPTERS.items()
        if source in enabled_sources and adapter.status is SourceAdapterStatus.HTTP and adapter.live_url
    }
    with _fixture_http_server(http_payloads) as base_url:
        for source, adapter in SOURCE_ADAPTERS.items():
            if source in enabled_sources and adapter.status is SourceAdapterStatus.HTTP and adapter.live_url:
                monkeypatch.setitem(
                    SOURCE_ADAPTERS,
                    source,
                    replace(
                        adapter,
                        live_url=f"{base_url}{adapter.integration_path}",
                        live_content_type=adapter.fixture_content_type,
                        live_expected_accession="",
                    ),
                )
        report = verify_live_adapters(rows)

    statuses = {check["source"]: check["status"] for check in report["checks"]}
    assert report["summary"]["failed"] == 0
    assert statuses["pubmed"] == "passed"
    assert statuses["chembl"] == "passed"
    assert statuses["clinicaltrials"] == "passed"
    assert statuses["hmdb"] == "blocked"
    assert statuses["drugbank"] == "blocked"
    assert statuses["t3db"] == "blocked"
    assert statuses["cas-common-chemistry"] == "blocked"
    assert statuses["echa"] == "passed"
    assert all(check["reason"] for check in report["checks"] if check["status"] == "blocked")


def test_live_verification_uses_operator_supplied_local_snapshots_for_restricted_or_unavailable_sources(tmp_path, monkeypatch):
    hmdb = tmp_path / "hmdb.jsonl"
    drugbank = tmp_path / "drugbank.jsonl"
    t3db = tmp_path / "t3db.jsonl"
    hmdb.write_text('{"accession":"HMDB0001879","name":"Aspirin"}\n', encoding="utf-8")
    drugbank.write_text('{"drugbank_id":"DB00945","name":"Aspirin"}\n', encoding="utf-8")
    t3db.write_text('{"t3db_id":"T3D0001","name":"Example toxin"}\n', encoding="utf-8")
    monkeypatch.setenv("HMDB_XML", str(hmdb))
    monkeypatch.setenv("DRUGBANK_INPUT", str(drugbank))
    monkeypatch.setenv("T3DB_INPUT", str(t3db))

    rows = [row for row in parse_sources_tsv(SOURCES_TSV) if row["source"] in {"hmdb", "drugbank", "t3db"}]
    report = verify_live_adapters(rows)

    assert report["summary"] == {"passed": 3, "failed": 0, "blocked": 0, "skipped": 0}
    assert {check["source"]: check["accessions"][0] for check in report["checks"]} == {
        "hmdb": "HMDB0001879",
        "drugbank": "DB00945",
        "t3db": "T3D0001",
    }


class _FixtureHandler(BaseHTTPRequestHandler):
    payloads = {}

    def do_GET(self):  # noqa: N802 - stdlib hook name
        payload = self.payloads.get(self.path)
        if payload is None:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):  # noqa: A002 - stdlib hook signature
        return


class _fixture_http_server:
    def __init__(self, payloads):
        self.payloads = payloads
        self.server = None
        self.thread = None

    def __enter__(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            host, port = sock.getsockname()
        _FixtureHandler.payloads = self.payloads
        self.server = HTTPServer(("127.0.0.1", port), _FixtureHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return f"http://127.0.0.1:{port}"

    def __exit__(self, exc_type, exc, tb):
        self.server.shutdown()
        self.thread.join(timeout=5)


def test_stage_restricted_source_script_copies_snapshot_and_writes_manifest(tmp_path):
    import subprocess
    import sys

    snapshot = tmp_path / "hmdb.jsonl"
    root = tmp_path / "chemlake"
    snapshot.write_text('{"accession":"HMDB0001879","name":"Aspirin"}\n', encoding="utf-8")

    result = subprocess.run(
        [
            sys.executable,
            str(REPO_ROOT / "workspace" / "scripts" / "stage_restricted_source.py"),
            "--source",
            "hmdb",
            "--input",
            str(snapshot),
            "--chemlake-root",
            str(root),
            "--copy",
        ],
        check=True,
        text=True,
        capture_output=True,
    )

    payload = json.loads(result.stdout)
    staged = root / "work" / "sources" / "hmdb" / snapshot.name
    manifest = root / "work" / "sources" / "hmdb" / "hmdb-snapshot-manifest.json"
    assert staged.exists()
    assert manifest.exists()
    assert payload["env_var"] == "HMDB_XML"
    assert payload["staged_path"] == str(staged)
    assert payload["export"].startswith("export HMDB_XML=")


def test_hmdb_directory_from_source_config_is_used_for_live_verification(tmp_path, monkeypatch):
    hmdb_dir = tmp_path / "hmdb-downloads"
    hmdb_dir.mkdir()
    (hmdb_dir / "hmdb_metabolites.xml").write_text(
        """<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<hmdb><metabolite><accession>HMDB0001879</accession><name>Aspirin</name></metabolite></hmdb>
""",
        encoding="utf-8",
    )
    config = tmp_path / "source-paths.env"
    config.write_text(f"HMDB_XML={hmdb_dir}\n", encoding="utf-8")
    monkeypatch.setenv("CHEMLAKE_SOURCE_CONFIG", str(config))
    monkeypatch.delenv("HMDB_XML", raising=False)

    rows = [row for row in parse_sources_tsv(SOURCES_TSV) if row["source"] == "hmdb"]
    report = verify_live_adapters(rows)

    assert report["summary"] == {"passed": 1, "failed": 0, "blocked": 0, "skipped": 0}
    assert report["checks"][0]["accessions"] == ["HMDB0001879"]


def test_hmdb_directory_zip_files_are_scanned_without_manual_extraction(tmp_path, monkeypatch):
    import zipfile

    hmdb_dir = tmp_path / "hmdb-zips"
    hmdb_dir.mkdir()
    xml_payload = """<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<hmdb xmlns=\"http://www.hmdb.ca\"><metabolite><accession>HMDB0001879</accession><name>Aspirin</name></metabolite></hmdb>
"""
    with zipfile.ZipFile(hmdb_dir / "hmdb_metabolites.zip", "w") as archive:
        archive.writestr("hmdb_metabolites.xml", xml_payload)
    with zipfile.ZipFile(hmdb_dir / "hmdb_structures.zip", "w") as archive:
        archive.writestr("structures.sdf", "2244\nM  END\n$$$$\n")

    config = tmp_path / "source-paths.env"
    config.write_text(f"HMDB_XML={hmdb_dir}\n", encoding="utf-8")
    monkeypatch.setenv("CHEMLAKE_SOURCE_CONFIG", str(config))
    monkeypatch.delenv("HMDB_XML", raising=False)

    rows = [row for row in parse_sources_tsv(SOURCES_TSV) if row["source"] == "hmdb"]
    report = verify_live_adapters(rows)

    assert report["summary"] == {"passed": 1, "failed": 0, "blocked": 0, "skipped": 0}
    assert report["checks"][0]["accessions"] == ["HMDB0001879"]
    assert report["checks"][0]["url"] == str(hmdb_dir)
