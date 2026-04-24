import json
import os
import subprocess
from pathlib import Path

from chem_evidence.cli import main
from chem_evidence.pubchem_ftp import (
    PUBCHEM_FTP_DATASETS,
    PubChemFtpObject,
    PubChemFtpPlanner,
    PubChemFtpWorker,
    parse_apache_index,
)


def test_pubchem_dataset_registry_covers_major_ftp_databases():
    expected = {
        "compound-current-sdf",
        "compound-current-xml",
        "compound-current-asn",
        "compound-extras",
        "substance-current-sdf",
        "substance-current-xml",
        "substance-current-asn",
        "substance-extras",
        "bioassay-json",
        "bioassay-csv",
        "bioassay-xml",
        "bioassay-asn",
        "compound-3d",
        "rdf",
        "target",
        "cooccurrence",
        "literature",
        "patents",
        "other",
    }

    assert expected.issubset(PUBCHEM_FTP_DATASETS)
    assert all(spec.path.endswith("/") for spec in PUBCHEM_FTP_DATASETS.values())


def test_pubchem_datasets_cli_lists_supported_ftp_databases(capsys):
    assert main(["pubchem", "datasets"]) == 0
    output = capsys.readouterr().out
    assert "compound-current-sdf" in output
    assert "bioassay-json" in output
    assert "rdf" in output


def test_parse_apache_index_extracts_files_sizes_and_md5_links():
    html = """
    <html><body><pre>
    <a href="Compound_000000001_000500000.sdf.gz">Compound_000000001_000500000.sdf.gz</a> 2026-03-27 04:25  493M
    <a href="Compound_000000001_000500000.sdf.gz.md5">Compound_000000001_000500000.sdf.gz.md5</a> 2026-03-27 04:25  68
    <a href="README">README</a> 2026-01-01 00:00  1K
    <a href="subdir/">subdir/</a> 2026-01-01 00:00  -
    </pre></body></html>
    """

    rows = parse_apache_index(html, "https://ftp.ncbi.nlm.nih.gov/pubchem/Compound/CURRENT-Full/SDF/")

    assert [row.name for row in rows] == ["Compound_000000001_000500000.sdf.gz", "subdir/"]
    assert rows[0].size_bytes == 493 * 1024 * 1024
    assert rows[0].md5_url.endswith(".md5")
    assert rows[1].is_dir is True


def test_planner_upserts_selected_datasets_from_fetcher():
    calls = []

    def fake_fetch(url):
        calls.append(url)
        return '<a href="A.sdf.gz">A.sdf.gz</a> 2026-01-01 00:00  10K\n<a href="A.sdf.gz.md5">A.sdf.gz.md5</a> 2026-01-01 00:00  40\n'

    class Store:
        def __init__(self):
            self.objects = []

        def upsert_remote_objects(self, objects):
            self.objects.extend(objects)
            return len(objects)

    store = Store()
    report = PubChemFtpPlanner(store, fetch_text=fake_fetch).plan(datasets=["compound-current-sdf"], limit=1)

    assert report["planned"] == 1
    assert store.objects[0].dataset == "compound-current-sdf"
    assert store.objects[0].url.endswith("/A.sdf.gz")
    assert store.objects[0].md5_url.endswith("/A.sdf.gz.md5")
    assert calls == [PUBCHEM_FTP_DATASETS["compound-current-sdf"].url]


def test_worker_downloads_claimed_objects_and_marks_downloaded(tmp_path):
    source = tmp_path / "remote.gz"
    source.write_bytes(b"payload")
    obj = PubChemFtpObject(
        dataset="compound-extras",
        name="remote.gz",
        path="Compound/Extras/remote.gz",
        url=source.as_uri(),
        size_bytes=7,
        last_modified="2026-04-24 01:00",
        md5_url="",
    )

    class Store:
        def __init__(self):
            self.downloaded = []
            self.failed = []

        def claim_remote_objects(self, *, source, worker_id, limit):
            return [{"id": "1", "metadata": obj.metadata()}]

        def mark_remote_object_downloaded(self, *, object_id, local_path, sha256, size_bytes):
            self.downloaded.append({"object_id": object_id, "local_path": local_path, "sha256": sha256, "size_bytes": size_bytes})

        def mark_remote_object_failed(self, *, object_id, error):
            self.failed.append({"object_id": object_id, "error": error})

    store = Store()
    report = PubChemFtpWorker(store, root=tmp_path / "mirror").run_once(source="pubchem", worker_id="worker-1", limit=1)

    assert report == {"claimed": 1, "downloaded": 1, "failed": 0}
    assert Path(store.downloaded[0]["local_path"]).read_bytes() == b"payload"
    assert store.downloaded[0]["size_bytes"] == 7
    assert store.failed == []


def test_pubchem_worker_sbatch_is_orchestrator_guarded():
    script = Path(__file__).resolve().parents[1] / "slurm" / "pubchem-worker.sbatch"
    text = script.read_text(encoding="utf-8")

    assert "source slurm/lib/common.sh" in text
    assert "setup_runtime" in text
    assert "run_chem pubchem worker" in text
    assert "CHEMLAKE_ORCHESTRATOR_RUN_ID" in text


def test_orchestrator_sbatch_plans_all_pubchem_datasets_before_running_service():
    script = Path(__file__).resolve().parents[1] / "slurm" / "chemlake-orchestrator.sbatch"
    text = script.read_text(encoding="utf-8")

    assert "pubchem plan" in text
    assert "CHEMLAKE_PUBCHEM_PLAN_DATASETS:-all" in text
    assert "CHEMLAKE_PUBCHEM_PLAN_ON_START:-1" in text
