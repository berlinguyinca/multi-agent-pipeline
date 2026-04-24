import json
from pathlib import Path

from chem_evidence.cli import main
from chem_evidence.source_orchestration import SourceWorkItem, SourceWorkPlanner, SourceWorkWorker


def test_source_work_planner_plans_all_enabled_non_pubchem_sources_from_registry(monkeypatch):
    monkeypatch.delenv("HMDB_XML", raising=False)
    monkeypatch.setenv("CHEMLAKE_SOURCE_CONFIG", "/missing/source-paths.env")
    rows = [
        {"source": "pubmed", "enabled": True, "mode": "api_literature_cache", "job": "pubmed_fetch"},
        {"source": "hmdb", "enabled": True, "mode": "local_import", "job": "local_import"},
        {"source": "nist", "enabled": False, "mode": "excluded", "job": "none"},
        {"source": "pubchem", "enabled": True, "mode": "mirror_transform", "job": "pubchem"},
    ]

    class Store:
        def __init__(self):
            self.items = []

        def upsert_remote_objects(self, objects):
            self.items.extend(objects)
            return len(objects)

    store = Store()
    report = SourceWorkPlanner(store).plan(rows=rows, sources=["all"], include_pubchem=False)

    assert report["planned"] == 1
    assert {item.source for item in store.items} == {"pubmed"}
    assert report["blocked"][0]["source"] == "hmdb"
    assert {item.metadata()["mode"] for item in store.items} == {"api_literature_cache"}


def test_source_work_planner_includes_local_source_only_when_snapshot_is_configured(monkeypatch, tmp_path):
    hmdb = tmp_path / "hmdb.jsonl"
    hmdb.write_text('{"accession":"HMDB0001879"}\n', encoding="utf-8")
    monkeypatch.setenv("HMDB_XML", str(hmdb))
    monkeypatch.delenv("CHEMLAKE_SOURCE_CONFIG", raising=False)

    class Store:
        def __init__(self):
            self.items = []

        def upsert_remote_objects(self, objects):
            self.items.extend(objects)
            return len(objects)

    store = Store()
    report = SourceWorkPlanner(store).plan(
        rows=[{"source": "hmdb", "enabled": True, "mode": "local_import", "job": "local_import"}],
        sources=["all"],
    )

    assert report["planned"] == 1
    assert report["blocked"] == []
    assert store.items[0].metadata()["url"] == str(hmdb)


def test_source_worker_downloads_http_work_item(tmp_path):
    remote = tmp_path / "remote.json"
    remote.write_text('{"ok": true}\n', encoding="utf-8")
    item = SourceWorkItem(
        source="pubmed",
        accession="pubmed:api_literature_cache",
        url=remote.as_uri(),
        mode="api_literature_cache",
        job="pubmed_fetch",
        metadata={"example": True},
    )

    class Store:
        def __init__(self):
            self.downloaded = []
            self.failed = []

        def claim_remote_objects(self, *, source, worker_id, limit):
            return [{"id": "1", "metadata": item.metadata()}]

        def mark_remote_object_downloaded(self, *, object_id, local_path, sha256, size_bytes):
            self.downloaded.append({"object_id": object_id, "local_path": local_path, "sha256": sha256, "size_bytes": size_bytes})

        def mark_remote_object_failed(self, *, object_id, error):
            self.failed.append({"object_id": object_id, "error": error})

    store = Store()
    report = SourceWorkWorker(store, root=tmp_path / "lake").run_once(source="pubmed", worker_id="w1", limit=1)

    assert report == {"claimed": 1, "downloaded": 1, "failed": 0}
    assert Path(store.downloaded[0]["local_path"]).read_text(encoding="utf-8") == '{"ok": true}\n'


def test_source_worker_fails_closed_for_placeholder_local_url(tmp_path):
    item = SourceWorkItem(
        source="hmdb",
        accession="hmdb:local_import",
        url="local://hmdb",
        mode="local_import",
        job="local_import",
    )

    class Store:
        def __init__(self):
            self.downloaded = []
            self.failed = []

        def claim_remote_objects(self, *, source, worker_id, limit):
            return [{"id": "1", "metadata": item.metadata()}]

        def mark_remote_object_downloaded(self, *, object_id, local_path, sha256, size_bytes):
            self.downloaded.append(object_id)

        def mark_remote_object_failed(self, *, object_id, error):
            self.failed.append({"object_id": object_id, "error": error})

    store = Store()
    report = SourceWorkWorker(store, root=tmp_path / "lake").run_once(source="hmdb", worker_id="w1", limit=1)

    assert report == {"claimed": 1, "downloaded": 0, "failed": 1}
    assert store.downloaded == []
    assert "no concrete downloadable/local path" in store.failed[0]["error"]


def test_sources_plan_work_cli_uses_registry_and_store(monkeypatch, tmp_path):
    from io import StringIO

    rows_file = tmp_path / "sources.tsv"
    rows_file.write_text(
        "source\tmode\tenabled\tjob\tmemory\tnotes\n"
        "pubmed\tapi_literature_cache\tyes\tpubmed_fetch\t1G\t\n"
        "nist\texcluded\tno\tnone\t0\t\n",
        encoding="utf-8",
    )

    class Store:
        def upsert_remote_objects(self, objects):
            self.objects = list(objects)
            return len(self.objects)

    store = Store()
    monkeypatch.setenv("CHEMLAKE_DB_BACKEND", "postgres")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_USER", "worker")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_PASSWORD", "secret")
    monkeypatch.setattr("chem_evidence.cli.PostgresSourceWorkStore", lambda database_url: store)
    out = StringIO()

    code = main(["sources", "plan-work", "--from", str(rows_file), "--source", "all"], stdout=out)

    assert code == 0
    payload = json.loads(out.getvalue())
    assert payload["planned"] == 1
    assert store.objects[0].source == "pubmed"


def test_generic_source_worker_sbatch_is_orchestrator_guarded():
    script = Path(__file__).resolve().parents[1] / "slurm" / "source-worker.sbatch"
    text = script.read_text(encoding="utf-8")

    assert "source slurm/lib/common.sh" in text
    assert "setup_runtime" in text
    assert "run_chem sources worker" in text
    assert "CHEMLAKE_ORCHESTRATOR_RUN_ID" in text
