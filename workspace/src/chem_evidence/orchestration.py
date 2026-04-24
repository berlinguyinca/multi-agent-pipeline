"""Postgres-backed Chemlake ingestion orchestration.

The orchestration service keeps production download workers alive without
introducing a second state store.  It reads and writes only the Postgres
operational tables used by the Hive PubChem catalog (`remote_objects`,
`blob_store`, and `sync_runs`).
"""
from __future__ import annotations

import json
import re
import shlex
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Protocol

from .sync_state import PostgresSyncState, SyncStateConfig

_JOB_ID_RE = re.compile(r"(?:Submitted\s+batch\s+job\s+)?(?P<job_id>\d+)\s*$")


@dataclass(frozen=True)
class OrchestrationConfig:
    source: str
    snapshot: str = ""
    target_workers: int = 4
    stale_claim_minutes: int = 90
    stale_run_minutes: int = 180
    stale_claim_limit: int = 500
    worker_label_prefix: str = "pubchem-worker"
    submit_command: str = ""
    dry_run: bool = False
    poll_seconds: int = 300
    orchestrator_run_id: str = ""
    orchestrator_job_id: str = ""

    def resolved_snapshot(self) -> str:
        if self.snapshot:
            return self.snapshot
        return datetime.now(timezone.utc).date().isoformat()


class OrchestrationStore(Protocol):
    def recover_stale_claims(self, *, source: str, stale_minutes: int, limit: int) -> int: ...

    def mark_stale_runs(self, *, source: str, stale_minutes: int, worker_label_prefix: str) -> int: ...

    def source_summary(self, *, source: str) -> Dict[str, Any]: ...

    def count_active_worker_runs(self, *, source: str, stale_minutes: int, worker_label_prefix: str) -> int: ...

    def record_submitted_run(
        self,
        *,
        run_id: str,
        source: str,
        snapshot: str,
        backend: str,
        job_id: str,
        label: str,
        metadata: Mapping[str, Any],
    ) -> None: ...

    def list_active_runs(self, *, source: str, stale_minutes: int, worker_label_prefix: str) -> List[Dict[str, Any]]: ...

    def update_run_status(self, *, run_id: str, status: str, message: str = "") -> None: ...

    def heartbeat_orchestrator(self, *, run_id: str, source: str, snapshot: str, job_id: str, metadata: Mapping[str, Any]) -> None: ...

    def assert_orchestrator_running(self, *, run_id: str, source: str, max_age_minutes: int) -> Dict[str, Any]: ...


class JobSubmitter(Protocol):
    def submit(
        self,
        *,
        source: str,
        worker_id: str,
        snapshot: str,
        orchestrator_run_id: str = "",
        orchestrator_job_id: str = "",
    ) -> str: ...


class RunStateStore(Protocol):
    def list_active_runs(self, *, source: str, stale_minutes: int, worker_label_prefix: str) -> List[Dict[str, Any]]: ...

    def update_run_status(self, *, run_id: str, status: str, message: str = "") -> None: ...


@dataclass(frozen=True)
class SlurmJobState:
    job_id: str
    state: str
    exit_code: str = ""

    def postgres_status(self) -> str:
        normalized = self.state.upper()
        if normalized in {"PENDING", "CONFIGURING", "COMPLETING", "RUNNING", "RESIZING", "SUSPENDED"}:
            return "running"
        if normalized in {"COMPLETED"}:
            return "completed"
        return "failed"

    def message(self) -> str:
        return f"Slurm {self.state} exit={self.exit_code or 'unknown'}"


class SlurmMonitor(Protocol):
    def states_for(self, job_ids: Iterable[str]) -> Dict[str, SlurmJobState]: ...


class SacctSlurmMonitor:
    def states_for(self, job_ids: Iterable[str]) -> Dict[str, SlurmJobState]:
        ids = [str(job_id) for job_id in job_ids if str(job_id).strip()]
        if not ids:
            return {}
        states: Dict[str, SlurmJobState] = {}
        try:
            squeue = subprocess.run(
                ["squeue", "--noheader", "--format=%i|%T", "--jobs", ",".join(ids)],
                check=True,
                text=True,
                capture_output=True,
            )
            states.update(parse_squeue_output(squeue.stdout))
        except (FileNotFoundError, subprocess.CalledProcessError):
            # Non-Hive dry-run/development hosts may not have squeue.  Fall back
            # to accounting, which is sufficient for terminal states.
            pass
        missing = [job_id for job_id in ids if job_id not in states]
        if not missing:
            return states
        command = [
            "sacct",
            "--noheader",
            "--parsable2",
            "--format=JobIDRaw,State,ExitCode",
            "--jobs",
            ",".join(missing),
        ]
        result = subprocess.run(command, check=True, text=True, capture_output=True)
        states.update(parse_sacct_output(result.stdout))
        return states


def parse_squeue_output(output: str) -> Dict[str, SlurmJobState]:
    states: Dict[str, SlurmJobState] = {}
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or "|" not in line:
            continue
        raw_job_id, state = line.split("|", 1)
        job_id = raw_job_id.split(".", 1)[0].strip()
        if not job_id:
            continue
        states[job_id] = SlurmJobState(job_id=job_id, state=state.strip(), exit_code="")
    return states


def parse_sacct_output(output: str) -> Dict[str, SlurmJobState]:
    states: Dict[str, SlurmJobState] = {}
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or line.lower().startswith("jobid"):
            continue
        parts = line.split("|")
        if len(parts) < 2:
            continue
        raw_job_id = parts[0].strip()
        state = parts[1].strip()
        exit_code = parts[2].strip() if len(parts) > 2 else ""
        job_id = raw_job_id.split(".", 1)[0]
        if not job_id:
            continue
        # Prefer terminal batch state over a non-terminal parent line when both appear.
        current = states.get(job_id)
        candidate = SlurmJobState(job_id=job_id, state=state, exit_code=exit_code)
        if current is None or raw_job_id.endswith(".batch") or current.postgres_status() == "running":
            states[job_id] = candidate
    return states


class SlurmStateReconciler:
    def __init__(self, store: RunStateStore, monitor: SlurmMonitor):
        self.store = store
        self.monitor = monitor

    def reconcile(self, *, source: str, stale_minutes: int, worker_label_prefix: str) -> Dict[str, int]:
        runs = self.store.list_active_runs(source=source, stale_minutes=stale_minutes, worker_label_prefix=worker_label_prefix)
        job_ids = [str(run.get("job_id") or "") for run in runs if run.get("job_id")]
        states = self.monitor.states_for(job_ids)
        counts = {"running": 0, "completed": 0, "failed": 0, "unknown": 0}
        for run in runs:
            run_id = str(run["id"])
            job_id = str(run.get("job_id") or "")
            state = states.get(job_id)
            if state is None:
                counts["unknown"] += 1
                self.store.update_run_status(run_id=run_id, status="stale", message=f"Slurm job id {job_id} is not visible to squeue/sacct")
                continue
            status = state.postgres_status()
            counts[status] += 1
            self.store.update_run_status(run_id=run_id, status=status, message=state.message())
        return counts


class NoopSubmitter:
    def submit(
        self,
        *,
        source: str,
        worker_id: str,
        snapshot: str,
        orchestrator_run_id: str = "",
        orchestrator_job_id: str = "",
    ) -> str:
        return f"dry-run:{worker_id}"


class ShellSubmitter:
    """Submit a worker using a shell command template.

    The template can reference `{source}`, `{worker_id}`, `{snapshot}`,
    `{orchestrator_run_id}`, and `{orchestrator_job_id}`.
    Values are shell-quoted before formatting so operators can safely use a
    single template string in Slurm scripts.
    """

    def __init__(self, template: str):
        if not template.strip():
            raise ValueError("submit command template is required")
        self.template = template

    def submit(
        self,
        *,
        source: str,
        worker_id: str,
        snapshot: str,
        orchestrator_run_id: str = "",
        orchestrator_job_id: str = "",
    ) -> str:
        command = self.template.format(
            source=shlex.quote(source),
            worker_id=shlex.quote(worker_id),
            snapshot=shlex.quote(snapshot),
            orchestrator_run_id=shlex.quote(orchestrator_run_id),
            orchestrator_job_id=shlex.quote(orchestrator_job_id),
        )
        result = subprocess.run(command, shell=True, check=True, text=True, capture_output=True)
        return parse_sbatch_job_id((result.stdout or result.stderr).strip())


def parse_sbatch_job_id(output: str) -> str:
    match = _JOB_ID_RE.search(output.strip())
    if not match:
        raise ValueError(f"Unable to parse Slurm job id from submit output: {output!r}")
    return match.group("job_id")


class PostgresOrchestrationStore:
    """Postgres implementation for the production remote-object catalog."""

    def __init__(self, database_url: str):
        self.state = PostgresSyncState(database_url)

    def recover_stale_claims(self, *, source: str, stale_minutes: int, limit: int) -> int:
        with self.state.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    WITH stale AS (
                        SELECT id
                        FROM chemlake.remote_objects
                        WHERE source = %s
                          AND status = 'claimed'
                          AND last_seen_at < NOW() - (%s * INTERVAL '1 minute')
                        ORDER BY last_seen_at ASC, id ASC
                        LIMIT %s
                    )
                    UPDATE chemlake.remote_objects ro
                    SET status = 'planned',
                        metadata = jsonb_set(
                            jsonb_set(ro.metadata, '{orchestration,last_released_at}', to_jsonb(NOW()::text), true),
                            '{orchestration,last_release_reason}', to_jsonb('stale claimed object'::text), true
                        ),
                        last_seen_at = NOW()
                    FROM stale
                    WHERE ro.id = stale.id
                    """,
                    (source, stale_minutes, limit),
                )
                count = int(cur.rowcount or 0)
            conn.commit()
        return count

    def mark_stale_runs(self, *, source: str, stale_minutes: int, worker_label_prefix: str) -> int:
        with self.state.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE chemlake.sync_runs
                    SET status = 'stale',
                        finished_at = COALESCE(finished_at, NOW()),
                        message = COALESCE(message, 'marked stale by orchestration service')
                    WHERE source = %s
                      AND status IN ('submitted', 'running')
                      AND started_at < NOW() - (%s * INTERVAL '1 minute')
                      AND COALESCE(metadata->>'label', '') LIKE %s
                    """,
                    (source, stale_minutes, f"{worker_label_prefix}%"),
                )
                count = int(cur.rowcount or 0)
            conn.commit()
        return count

    def source_summary(self, *, source: str) -> Dict[str, Any]:
        with self.state.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        %s AS source,
                        COUNT(*) FILTER (WHERE ro.status = 'planned') AS planned,
                        COUNT(*) FILTER (WHERE ro.status = 'claimed') AS claimed,
                        COUNT(*) FILTER (WHERE ro.status = 'downloaded') AS downloaded,
                        COUNT(bs.sha256) AS blob_count,
                        COALESCE(SUM(bs.size_bytes), 0) AS blob_bytes,
                        MAX(bs.updated_at) AS last_blob_at,
                        MAX(ro.last_seen_at) AS last_catalog_at
                    FROM chemlake.remote_objects ro
                    LEFT JOIN chemlake.blob_store bs
                      ON bs.sha256 = ro.blob_sha256
                    WHERE ro.source = %s
                    """,
                    (source, source),
                )
                row = cur.fetchone()
        return dict(row) if row else _empty_summary(source)

    def count_active_worker_runs(self, *, source: str, stale_minutes: int, worker_label_prefix: str) -> int:
        with self.state.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COUNT(*) AS count
                    FROM chemlake.sync_runs
                    WHERE source = %s
                      AND status IN ('submitted', 'running')
                      AND started_at >= NOW() - (%s * INTERVAL '1 minute')
                      AND COALESCE(metadata->>'label', '') LIKE %s
                    """,
                    (source, stale_minutes, f"{worker_label_prefix}%"),
                )
                row = cur.fetchone()
        return int(row["count"] if row else 0)

    def record_submitted_run(
        self,
        *,
        run_id: str,
        source: str,
        snapshot: str,
        backend: str,
        job_id: str,
        label: str,
        metadata: Mapping[str, Any],
    ) -> None:
        payload = dict(metadata)
        payload.update({"job_id": job_id, "label": label, "orchestrated": True})
        with self.state.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO chemlake.sync_runs(id, source, snapshot, backend, status, started_at, metadata)
                    VALUES (%s, %s, %s, %s, 'submitted', NOW(), %s::jsonb)
                    ON CONFLICT (id) DO UPDATE SET
                        status = EXCLUDED.status,
                        started_at = EXCLUDED.started_at,
                        finished_at = NULL,
                        message = NULL,
                        metadata = EXCLUDED.metadata
                    """,
                    (run_id, source, snapshot, backend, json.dumps(payload, sort_keys=True)),
                )
            conn.commit()

    def heartbeat_orchestrator(self, *, run_id: str, source: str, snapshot: str, job_id: str, metadata: Mapping[str, Any]) -> None:
        payload = dict(metadata)
        payload.update(
            {
                "job_id": job_id,
                "label": payload.get("label", "chemlake-orchestrator"),
                "role": "orchestrator",
                "heartbeat_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        with self.state.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO chemlake.sync_runs(id, source, snapshot, backend, status, started_at, finished_at, message, metadata)
                    VALUES (%s, %s, %s, 'orchestration', 'running', NOW(), NULL, 'orchestrator heartbeat', %s::jsonb)
                    ON CONFLICT (id) DO UPDATE SET
                        status = 'running',
                        finished_at = NULL,
                        message = 'orchestrator heartbeat',
                        metadata = chemlake.sync_runs.metadata || EXCLUDED.metadata
                    """,
                    (run_id, source, snapshot, json.dumps(payload, sort_keys=True)),
                )
            conn.commit()

    def assert_orchestrator_running(self, *, run_id: str, source: str, max_age_minutes: int) -> Dict[str, Any]:
        with self.state.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, source, snapshot, backend, status, started_at, metadata
                    FROM chemlake.sync_runs
                    WHERE id = %s
                      AND source = %s
                      AND status = 'running'
                      AND metadata->>'role' = 'orchestrator'
                      AND COALESCE((metadata->>'heartbeat_at')::timestamptz, started_at)
                            >= NOW() - (%s * INTERVAL '1 minute')
                    """,
                    (run_id, source, max_age_minutes),
                )
                row = cur.fetchone()
        if not row:
            raise RuntimeError(f"orchestrator service is not running or heartbeat is stale: {run_id}")
        return dict(row)

    def list_active_runs(self, *, source: str, stale_minutes: int, worker_label_prefix: str) -> List[Dict[str, Any]]:
        with self.state.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        id,
                        metadata->>'job_id' AS job_id,
                        metadata->>'label' AS label,
                        status,
                        started_at
                    FROM chemlake.sync_runs
                    WHERE source = %s
                      AND status IN ('submitted', 'running')
                      AND started_at >= NOW() - (%s * INTERVAL '1 minute')
                      AND COALESCE(metadata->>'label', '') LIKE %s
                    ORDER BY started_at ASC, id ASC
                    """,
                    (source, stale_minutes, f"{worker_label_prefix}%"),
                )
                return [dict(row) for row in cur.fetchall()]

    def update_run_status(self, *, run_id: str, status: str, message: str = "") -> None:
        with self.state.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE chemlake.sync_runs
                    SET status = %s,
                        finished_at = CASE
                            WHEN %s IN ('completed', 'failed', 'stale') THEN COALESCE(finished_at, NOW())
                            ELSE NULL
                        END,
                        message = %s
                    WHERE id = %s
                    """,
                    (status, status, message, run_id),
                )
            conn.commit()


class OrchestrationService:
    def __init__(self, store: OrchestrationStore, submitter: JobSubmitter, reconciler: Optional[SlurmStateReconciler] = None):
        self.store = store
        self.submitter = submitter
        self.reconciler = reconciler

    def run_once(self, config: OrchestrationConfig) -> Dict[str, Any]:
        snapshot = config.resolved_snapshot()
        orchestrator_run_id = config.orchestrator_run_id or f"orchestrator:{config.source}:{snapshot}"
        orchestrator_job_id = config.orchestrator_job_id
        slurm_reconciliation = None
        before = self.store.source_summary(source=config.source)
        active = self.store.count_active_worker_runs(
            source=config.source,
            stale_minutes=config.stale_run_minutes,
            worker_label_prefix=config.worker_label_prefix,
        )
        planned_before = int(before.get("planned") or 0)
        missing_workers_before = max(0, int(config.target_workers) - int(active))
        would_submit = min(missing_workers_before, planned_before) if planned_before > 0 else 0
        if config.dry_run:
            return {
                "source": config.source,
                "snapshot": snapshot,
                "before": _jsonable_summary(before),
                "after": _jsonable_summary(before),
                "recovered_claims": 0,
                "stale_runs_marked": 0,
                "active_worker_runs": active,
                "target_workers": config.target_workers,
                "workers_submitted": 0,
                "would_submit_workers": would_submit,
                "submitted": [],
                "dry_run": True,
                "slurm_reconciliation": slurm_reconciliation,
                "orchestrator_run_id": orchestrator_run_id,
                "orchestrator_job_id": orchestrator_job_id,
            }
        self.store.heartbeat_orchestrator(
            run_id=orchestrator_run_id,
            source=config.source,
            snapshot=snapshot,
            job_id=orchestrator_job_id,
            metadata={"label": "chemlake-orchestrator", "role": "orchestrator"},
        )
        if self.reconciler is not None:
            slurm_reconciliation = self.reconciler.reconcile(
                source=config.source,
                stale_minutes=config.stale_run_minutes,
                worker_label_prefix=config.worker_label_prefix,
            )
        recovered = self.store.recover_stale_claims(
            source=config.source,
            stale_minutes=config.stale_claim_minutes,
            limit=config.stale_claim_limit,
        )
        stale_runs = self.store.mark_stale_runs(
            source=config.source,
            stale_minutes=config.stale_run_minutes,
            worker_label_prefix=config.worker_label_prefix,
        )
        active = self.store.count_active_worker_runs(
            source=config.source,
            stale_minutes=config.stale_run_minutes,
            worker_label_prefix=config.worker_label_prefix,
        )
        after_recovery = self.store.source_summary(source=config.source)
        planned = int(after_recovery.get("planned") or 0)
        missing_workers = max(0, int(config.target_workers) - int(active))
        to_submit = min(missing_workers, planned) if planned > 0 else 0
        submitted = []
        for index in range(1, to_submit + 1):
            worker_id = f"{config.worker_label_prefix}-{index}"
            job_id = self.submitter.submit(
                source=config.source,
                worker_id=worker_id,
                snapshot=snapshot,
                orchestrator_run_id=orchestrator_run_id,
                orchestrator_job_id=orchestrator_job_id,
            )
            run_id = f"{config.source}:{snapshot}:{job_id}:{worker_id}"
            self.store.record_submitted_run(
                run_id=run_id,
                source=config.source,
                snapshot=snapshot,
                backend="slurm",
                job_id=job_id,
                label=worker_id,
                metadata={
                    "worker_id": worker_id,
                    "target_workers": config.target_workers,
                    "orchestrator_run_id": orchestrator_run_id,
                    "orchestrator_job_id": orchestrator_job_id,
                },
            )
            submitted.append({"worker_id": worker_id, "job_id": job_id, "run_id": run_id})
        after = after_recovery
        return {
            "source": config.source,
            "snapshot": snapshot,
            "before": _jsonable_summary(before),
            "after": _jsonable_summary(after),
            "recovered_claims": recovered,
            "stale_runs_marked": stale_runs,
            "active_worker_runs": active,
            "target_workers": config.target_workers,
            "workers_submitted": len(submitted),
            "would_submit_workers": len(submitted),
            "submitted": submitted,
            "dry_run": False,
            "slurm_reconciliation": slurm_reconciliation,
            "orchestrator_run_id": orchestrator_run_id,
            "orchestrator_job_id": orchestrator_job_id,
        }

    def run_forever(self, config: OrchestrationConfig):
        while True:
            yield self.run_once(config)
            time.sleep(config.poll_seconds)


def build_postgres_orchestration_service(
    config: SyncStateConfig,
    submit_command: str,
    *,
    dry_run: bool = False,
    monitor_slurm: bool = True,
) -> OrchestrationService:
    if config.backend != "postgres":
        raise ValueError("orchestrate requires CHEMLAKE_DB_BACKEND=postgres")
    store = PostgresOrchestrationStore(config.database_url)
    submitter: JobSubmitter = NoopSubmitter() if dry_run else ShellSubmitter(submit_command)
    reconciler = SlurmStateReconciler(store, SacctSlurmMonitor()) if monitor_slurm else None
    return OrchestrationService(store, submitter, reconciler)


def _empty_summary(source: str) -> Dict[str, Any]:
    return {"source": source, "planned": 0, "claimed": 0, "downloaded": 0, "blob_count": 0, "blob_bytes": 0, "last_blob_at": None, "last_catalog_at": None}


def _jsonable_summary(summary: Mapping[str, Any]) -> Dict[str, Any]:
    result = dict(summary)
    for key, value in list(result.items()):
        if isinstance(value, datetime):
            result[key] = value.isoformat()
    return result
