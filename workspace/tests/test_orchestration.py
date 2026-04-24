import json
import os
import subprocess
from dataclasses import dataclass, field

import pytest

from chem_evidence.cli import main
from chem_evidence.orchestration import (
    OrchestrationConfig,
    OrchestrationService,
    ShellSubmitter,
    parse_sbatch_job_id,
)


@dataclass
class FakeStore:
    summary_rows: list[dict]
    active_runs: int = 0
    recovered_claims: int = 0
    stale_runs: int = 0
    recorded: list[dict] = field(default_factory=list)
    heartbeats: list[dict] = field(default_factory=list)
    assertions: list[dict] = field(default_factory=list)

    def recover_stale_claims(self, *, source: str, stale_minutes: int, limit: int) -> int:
        assert source == "pubchem"
        assert stale_minutes == 90
        assert limit == 500
        return self.recovered_claims

    def mark_stale_runs(self, *, source: str, stale_minutes: int, worker_label_prefix: str) -> int:
        assert source == "pubchem"
        assert stale_minutes == 180
        assert worker_label_prefix == "pubchem-worker"
        return self.stale_runs

    def source_summary(self, *, source: str) -> dict:
        assert source == "pubchem"
        return self.summary_rows.pop(0)

    def count_active_worker_runs(self, *, source: str, stale_minutes: int, worker_label_prefix: str) -> int:
        assert source == "pubchem"
        assert stale_minutes == 180
        assert worker_label_prefix == "pubchem-worker"
        return self.active_runs

    def record_submitted_run(self, *, run_id: str, source: str, snapshot: str, backend: str, job_id: str, label: str, metadata: dict) -> None:
        self.recorded.append(
            {
                "run_id": run_id,
                "source": source,
                "snapshot": snapshot,
                "backend": backend,
                "job_id": job_id,
                "label": label,
                "metadata": metadata,
            }
        )

    def heartbeat_orchestrator(self, *, run_id: str, source: str, snapshot: str, job_id: str, metadata: dict) -> None:
        self.heartbeats.append({"run_id": run_id, "source": source, "snapshot": snapshot, "job_id": job_id, "metadata": metadata})

    def assert_orchestrator_running(self, *, run_id: str, source: str, max_age_minutes: int) -> dict:
        self.assertions.append({"run_id": run_id, "source": source, "max_age_minutes": max_age_minutes})
        return {"id": run_id, "source": source, "status": "running"}


class FakeSubmitter:
    def __init__(self):
        self.commands = []

    def submit(self, *, source: str, worker_id: str, snapshot: str, orchestrator_run_id: str = "", orchestrator_job_id: str = "") -> str:
        self.commands.append(
            {
                "source": source,
                "worker_id": worker_id,
                "snapshot": snapshot,
                "orchestrator_run_id": orchestrator_run_id,
                "orchestrator_job_id": orchestrator_job_id,
            }
        )
        return f"job-{len(self.commands)}"


def test_orchestration_run_once_recovers_stale_claims_and_submits_missing_workers():
    store = FakeStore(
        summary_rows=[
            {
                "source": "pubchem",
                "planned": 23075,
                "claimed": 45,
                "downloaded": 1505,
                "blob_count": 1510,
                "blob_bytes": 274553680260,
                "last_blob_at": "2026-04-24T14:31:29Z",
            },
            {
                "source": "pubchem",
                "planned": 23120,
                "claimed": 0,
                "downloaded": 1505,
                "blob_count": 1510,
                "blob_bytes": 274553680260,
                "last_blob_at": "2026-04-24T14:31:29Z",
            },
        ],
        active_runs=1,
        recovered_claims=45,
        stale_runs=3,
    )
    submitter = FakeSubmitter()
    service = OrchestrationService(store, submitter)

    report = service.run_once(
        OrchestrationConfig(
            source="pubchem",
            snapshot="2026-04-24",
            target_workers=4,
            stale_claim_minutes=90,
            stale_run_minutes=180,
            stale_claim_limit=500,
            worker_label_prefix="pubchem-worker",
        )
    )

    assert report["recovered_claims"] == 45
    assert report["stale_runs_marked"] == 3
    assert report["workers_submitted"] == 3
    assert [item["worker_id"] for item in submitter.commands] == [
        "pubchem-worker-1",
        "pubchem-worker-2",
        "pubchem-worker-3",
    ]
    assert [item["job_id"] for item in store.recorded] == ["job-1", "job-2", "job-3"]
    assert report["before"]["planned"] == 23075
    assert report["after"]["planned"] == 23120


def test_orchestration_heartbeats_service_and_stamps_submitted_workers():
    store = FakeStore(
        summary_rows=[
            {"source": "pubchem", "planned": 2, "claimed": 0, "downloaded": 1, "blob_count": 1, "blob_bytes": 100, "last_blob_at": "now"},
            {"source": "pubchem", "planned": 2, "claimed": 0, "downloaded": 1, "blob_count": 1, "blob_bytes": 100, "last_blob_at": "now"},
        ],
        active_runs=0,
    )
    submitter = FakeSubmitter()

    report = OrchestrationService(store, submitter).run_once(
        OrchestrationConfig(
            source="pubchem",
            snapshot="2026-04-24",
            target_workers=2,
            orchestrator_run_id="orchestrator-run-1",
            orchestrator_job_id="999",
        )
    )

    assert store.heartbeats == [
        {
            "run_id": "orchestrator-run-1",
            "source": "pubchem",
            "snapshot": "2026-04-24",
            "job_id": "999",
            "metadata": {"label": "chemlake-orchestrator", "role": "orchestrator"},
        }
    ]
    assert [command["orchestrator_run_id"] for command in submitter.commands] == ["orchestrator-run-1", "orchestrator-run-1"]
    assert [command["orchestrator_job_id"] for command in submitter.commands] == ["999", "999"]
    assert {row["metadata"]["orchestrator_run_id"] for row in store.recorded} == {"orchestrator-run-1"}
    assert {row["metadata"]["orchestrator_job_id"] for row in store.recorded} == {"999"}
    assert report["orchestrator_run_id"] == "orchestrator-run-1"


def test_orchestration_does_not_submit_when_no_planned_work_remains():
    store = FakeStore(
        summary_rows=[
            {"source": "pubchem", "planned": 0, "claimed": 0, "downloaded": 10, "blob_count": 10, "blob_bytes": 100, "last_blob_at": "now"},
            {"source": "pubchem", "planned": 0, "claimed": 0, "downloaded": 10, "blob_count": 10, "blob_bytes": 100, "last_blob_at": "now"},
        ],
        active_runs=0,
    )
    submitter = FakeSubmitter()

    report = OrchestrationService(store, submitter).run_once(OrchestrationConfig(source="pubchem", snapshot="2026-04-24", target_workers=4))

    assert report["workers_submitted"] == 0
    assert submitter.commands == []
    assert store.recorded == []




def test_orchestration_dry_run_reports_without_mutating_or_submitting():
    store = FakeStore(
        summary_rows=[
            {"source": "pubchem", "planned": 5, "claimed": 2, "downloaded": 1, "blob_count": 1, "blob_bytes": 10, "last_blob_at": "now"},
        ],
        active_runs=1,
        recovered_claims=99,
        stale_runs=99,
    )
    submitter = FakeSubmitter()

    report = OrchestrationService(store, submitter).run_once(
        OrchestrationConfig(source="pubchem", snapshot="2026-04-24", target_workers=4, dry_run=True)
    )

    assert report["recovered_claims"] == 0
    assert report["stale_runs_marked"] == 0
    assert report["would_submit_workers"] == 3
    assert report["workers_submitted"] == 0
    assert submitter.commands == []
    assert store.recorded == []


def test_orchestration_dry_run_does_not_reconcile_slurm_state():
    store = FakeStore(
        summary_rows=[
            {"source": "pubchem", "planned": 5, "claimed": 0, "downloaded": 1, "blob_count": 1, "blob_bytes": 10, "last_blob_at": "now"},
        ],
        active_runs=1,
    )

    class ExplodingReconciler:
        def reconcile(self, *, source: str, stale_minutes: int, worker_label_prefix: str):
            raise AssertionError("dry-run must not mutate sync_runs through Slurm reconciliation")

    report = OrchestrationService(store, FakeSubmitter(), ExplodingReconciler()).run_once(
        OrchestrationConfig(source="pubchem", snapshot="2026-04-24", target_workers=4, dry_run=True)
    )

    assert report["dry_run"] is True
    assert report["slurm_reconciliation"] is None


def test_parse_sbatch_job_id_accepts_common_sbatch_output():
    assert parse_sbatch_job_id("Submitted batch job 13105561\n") == "13105561"
    assert parse_sbatch_job_id("13105561\n") == "13105561"
    with pytest.raises(ValueError, match="Unable to parse Slurm job id"):
        parse_sbatch_job_id("queued somewhere else")


def test_shell_submitter_renders_template_and_parses_job_id(monkeypatch):
    calls = []

    def fake_run(cmd, shell, check, text, capture_output):
        calls.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, stdout="Submitted batch job 42\n", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    submitter = ShellSubmitter(
        "sbatch --dependency=after:{orchestrator_job_id} "
        "--export=ALL,CHEMLAKE_ORCHESTRATOR_RUN_ID={orchestrator_run_id} "
        "--job-name {worker_id} run_pubchem.sh --source {source} --snapshot {snapshot}"
    )

    assert (
        submitter.submit(
            source="pubchem",
            worker_id="pubchem-worker-1",
            snapshot="2026-04-24",
            orchestrator_run_id="orchestrator-run-1",
            orchestrator_job_id="999",
        )
        == "42"
    )
    assert calls == [
        "sbatch --dependency=after:999 --export=ALL,CHEMLAKE_ORCHESTRATOR_RUN_ID=orchestrator-run-1 "
        "--job-name pubchem-worker-1 run_pubchem.sh --source pubchem --snapshot 2026-04-24"
    ]


def test_cli_orchestrate_requires_postgres_backend(monkeypatch, capsys):
    monkeypatch.setenv("CHEMLAKE_DB_BACKEND", "sqlite")

    code = main(["orchestrate", "pubchem", "--once", "--dry-run"])

    assert code == 2
    error = json.loads(capsys.readouterr().out)
    assert error["error"] == "orchestrate requires CHEMLAKE_DB_BACKEND=postgres"


def test_cli_orchestrate_requires_submit_command_when_not_dry_run(monkeypatch, capsys):
    monkeypatch.setenv("CHEMLAKE_DB_BACKEND", "postgres")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_USER", "worker")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_PASSWORD", "secret")

    code = main(["orchestrate", "pubchem", "--once"])

    assert code == 2
    error = json.loads(capsys.readouterr().out)
    assert error["error"] == "--submit-command or CHEMLAKE_ORCHESTRATOR_SUBMIT_COMMAND is required unless --dry-run is set"


def test_slurm_state_reconciler_updates_postgres_runs_from_sacct():
    from chem_evidence.orchestration import SlurmJobState, SlurmStateReconciler

    class StoreWithRuns(FakeStore):
        def __init__(self):
            super().__init__(summary_rows=[])
            self.updates = []

        def list_active_runs(self, *, source: str, stale_minutes: int, worker_label_prefix: str):
            assert source == "pubchem"
            assert stale_minutes == 180
            assert worker_label_prefix == "pubchem-worker"
            return [
                {"id": "run-1", "job_id": "101", "label": "pubchem-worker-1"},
                {"id": "run-2", "job_id": "102", "label": "pubchem-worker-2"},
                {"id": "run-3", "job_id": "103", "label": "pubchem-worker-3"},
            ]

        def update_run_status(self, *, run_id: str, status: str, message: str = "") -> None:
            self.updates.append({"run_id": run_id, "status": status, "message": message})

    class FakeMonitor:
        def states_for(self, job_ids):
            assert job_ids == ["101", "102", "103"]
            return {
                "101": SlurmJobState(job_id="101", state="RUNNING", exit_code="0:0"),
                "102": SlurmJobState(job_id="102", state="COMPLETED", exit_code="0:0"),
                "103": SlurmJobState(job_id="103", state="FAILED", exit_code="1:0"),
            }

    store = StoreWithRuns()
    report = SlurmStateReconciler(store, FakeMonitor()).reconcile(
        source="pubchem",
        stale_minutes=180,
        worker_label_prefix="pubchem-worker",
    )

    assert report == {"running": 1, "completed": 1, "failed": 1, "unknown": 0}
    assert store.updates == [
        {"run_id": "run-1", "status": "running", "message": "Slurm RUNNING exit=0:0"},
        {"run_id": "run-2", "status": "completed", "message": "Slurm COMPLETED exit=0:0"},
        {"run_id": "run-3", "status": "failed", "message": "Slurm FAILED exit=1:0"},
    ]


def test_slurm_state_reconciler_marks_missing_slurm_job_unknown():
    from chem_evidence.orchestration import SlurmStateReconciler

    class StoreWithRuns(FakeStore):
        def __init__(self):
            super().__init__(summary_rows=[])
            self.updates = []

        def list_active_runs(self, *, source: str, stale_minutes: int, worker_label_prefix: str):
            return [{"id": "run-1", "job_id": "404", "label": "pubchem-worker-1"}]

        def update_run_status(self, *, run_id: str, status: str, message: str = "") -> None:
            self.updates.append((run_id, status, message))

    class EmptyMonitor:
        def states_for(self, job_ids):
            return {}

    store = StoreWithRuns()
    report = SlurmStateReconciler(store, EmptyMonitor()).reconcile(
        source="pubchem",
        stale_minutes=180,
        worker_label_prefix="pubchem-worker",
    )

    assert report["unknown"] == 1
    assert store.updates == [("run-1", "stale", "Slurm job id 404 is not visible to squeue/sacct")]


def test_parse_sacct_output_keeps_latest_batch_or_parent_state():
    from chem_evidence.orchestration import parse_sacct_output

    output = """JobIDRaw|State|ExitCode\n101|RUNNING|0:0\n102.batch|COMPLETED|0:0\n103|FAILED|1:0\n"""

    states = parse_sacct_output(output)

    assert states["101"].state == "RUNNING"
    assert states["102"].state == "COMPLETED"
    assert states["103"].exit_code == "1:0"


def test_parse_squeue_output_reports_active_slurm_jobs_before_accounting():
    from chem_evidence.orchestration import parse_squeue_output

    states = parse_squeue_output("101|RUNNING\n102|PENDING\n")

    assert states["101"].postgres_status() == "running"
    assert states["102"].state == "PENDING"


def test_cli_orchestrate_accepts_submit_command_from_environment(monkeypatch):
    from io import StringIO

    class FakeService:
        def __init__(self):
            self.configs = []

        def run_once(self, config):
            self.configs.append(config)
            return {"submit_command": config.submit_command}

    service = FakeService()

    def fake_builder(config, submit_command, *, dry_run=False, monitor_slurm=True):
        assert submit_command == (
            "sbatch --dependency=after:{orchestrator_job_id} "
            "--export=ALL,CHEMLAKE_ORCHESTRATOR_RUN_ID={orchestrator_run_id} "
            "worker.sbatch --source {source}"
        )
        assert monitor_slurm is True
        return service

    monkeypatch.setenv("CHEMLAKE_DB_BACKEND", "postgres")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_USER", "worker")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_PASSWORD", "secret")
    monkeypatch.setenv(
        "CHEMLAKE_ORCHESTRATOR_SUBMIT_COMMAND",
        "sbatch --dependency=after:{orchestrator_job_id} "
        "--export=ALL,CHEMLAKE_ORCHESTRATOR_RUN_ID={orchestrator_run_id} "
        "worker.sbatch --source {source}",
    )
    monkeypatch.setenv("SLURM_JOB_ID", "999")
    monkeypatch.setattr("chem_evidence.cli.build_postgres_orchestration_service", fake_builder)
    out = StringIO()

    code = main(["orchestrate", "pubchem", "--once"], stdout=out)

    assert code == 0
    assert "{orchestrator_run_id}" in json.loads(out.getvalue())["submit_command"]
    assert "{orchestrator_job_id}" in service.configs[0].submit_command
    assert service.configs[0].orchestrator_job_id == "999"
    assert service.configs[0].orchestrator_run_id.startswith("orchestrator:pubchem:")


def test_cli_orchestrate_all_expands_enabled_registry_sources(monkeypatch, tmp_path):
    from io import StringIO

    rows_file = tmp_path / "sources.tsv"
    rows_file.write_text(
        "source\tmode\tenabled\tjob\tmemory\tnotes\n"
        "pubchem\tmirror_transform\tyes\tpubchem\t4G\t\n"
        "pubmed\tapi_literature_cache\tyes\tpubmed_fetch\t1G\t\n"
        "nist\texcluded\tno\tnone\t0\t\n",
        encoding="utf-8",
    )

    class FakeService:
        def __init__(self):
            self.configs = []

        def run_once(self, config):
            self.configs.append(config)
            return {"source": config.source, "worker_label_prefix": config.worker_label_prefix}

    service = FakeService()

    monkeypatch.setenv("CHEMLAKE_DB_BACKEND", "postgres")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_USER", "worker")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_PASSWORD", "secret")
    monkeypatch.setenv("SLURM_JOB_ID", "999")
    monkeypatch.setenv("CHEMLAKE_ORCHESTRATOR_RUN_ID", "orchestrator:all:service")
    monkeypatch.setenv(
        "CHEMLAKE_ORCHESTRATOR_SUBMIT_COMMAND",
        "sbatch --dependency=after:{orchestrator_job_id} "
        "--export=ALL,CHEMLAKE_ORCHESTRATOR_RUN_ID={orchestrator_run_id} "
        "slurm/chemlake-worker-dispatch.sbatch --source {source}",
    )
    monkeypatch.setattr("chem_evidence.cli.build_postgres_orchestration_service", lambda *args, **kwargs: service)
    out = StringIO()

    code = main(["orchestrate", "all", "--once", "--sources-from", str(rows_file)], stdout=out)

    assert code == 0
    payload = json.loads(out.getvalue())
    assert payload["sources"] == ["pubchem", "pubmed"]
    assert [config.source for config in service.configs] == ["pubchem", "pubmed"]
    assert [config.worker_label_prefix for config in service.configs] == ["pubchem-worker", "pubmed-worker"]
    assert [config.orchestrator_run_id for config in service.configs] == [
        "orchestrator:all:service:pubchem",
        "orchestrator:all:service:pubmed",
    ]


def test_cli_orchestrate_all_fails_closed_when_registry_is_missing(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("CHEMLAKE_DB_BACKEND", "postgres")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_USER", "worker")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_PASSWORD", "secret")

    code = main(["orchestrate", "all", "--once", "--dry-run", "--sources-from", str(tmp_path / "missing.tsv")])

    assert code == 2
    assert "source registry TSV is required" in json.loads(capsys.readouterr().out)["error"]


def test_cli_orchestrate_rejects_unmanaged_submit_command(monkeypatch, capsys):
    monkeypatch.setenv("CHEMLAKE_DB_BACKEND", "postgres")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_USER", "worker")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_PASSWORD", "secret")
    monkeypatch.setenv("SLURM_JOB_ID", "999")

    code = main(["orchestrate", "pubchem", "--once", "--submit-command", "sbatch worker.sbatch --source {source}"])

    assert code == 2
    error = json.loads(capsys.readouterr().out)
    assert "orchestrator_run_id" in error["error"]


def test_cli_orchestrate_assert_service_uses_postgres_store(monkeypatch):
    from io import StringIO

    class FakeStoreForAssert:
        def assert_orchestrator_running(self, *, run_id: str, source: str, max_age_minutes: int):
            assert run_id == "orchestrator-run-1"
            assert source == "pubchem"
            assert max_age_minutes == 10
            return {"id": run_id, "status": "running", "source": source}

    monkeypatch.setenv("CHEMLAKE_DB_BACKEND", "postgres")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_USER", "worker")
    monkeypatch.setenv("CHEMLAKE_POSTGRES_PASSWORD", "secret")
    monkeypatch.setattr("chem_evidence.cli.PostgresOrchestrationStore", lambda database_url: FakeStoreForAssert())
    out = StringIO()

    code = main(
        [
            "orchestrate",
            "pubchem",
            "--assert-service",
            "--orchestrator-run-id",
            "orchestrator-run-1",
            "--orchestrator-heartbeat-minutes",
            "10",
        ],
        stdout=out,
    )

    assert code == 0
    assert json.loads(out.getvalue())["status"] == "running"
