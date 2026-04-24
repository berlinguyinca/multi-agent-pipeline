"""Command-line interface for the Chemlake resolver."""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from pathlib import Path
from typing import Iterable, List, Optional, TextIO

from .resolver import ChemlakeResolver
from .metabolomics import MetabolomicsHarvester, MetabolomicsIndex, MetabolomicsMirror
from .sync_state import SyncStateConfig, connect_sync_state, display_database_url, import_sources_tsv
from .orchestration import OrchestrationConfig, PostgresOrchestrationStore, build_postgres_orchestration_service
from .pubchem_ftp import PUBCHEM_FTP_DATASETS, PostgresPubChemFtpStore, PubChemFtpPlanner, PubChemFtpWorker
from .source_orchestration import PostgresSourceWorkStore, SourceWorkPlanner, SourceWorkWorker
from .source_adapters import parse_sources_tsv, verify_live_adapters, verify_registered_adapters


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="chemlake", description="Offline Chemlake chemical identifier resolver")
    parser.add_argument("--data-dir", help="Directory containing Chemlake JSONL resolver artifacts")
    sub = parser.add_subparsers(dest="cmd")

    for name, help_text in [
        ("resolve", "Resolve mixed chemical identifiers to local Chemlake outputs"),
        ("translate", "Compatibility alias for resolve"),
    ]:
        command = sub.add_parser(name, help=help_text)
        command.add_argument("--input", required=True, help="Input file with one query per line, or - for stdin")
        command.add_argument("--from", dest="from_namespace", default="auto", help="Input namespace or auto")
        command.add_argument("--to", default="all", help="Output namespace list or all")
        command.add_argument("--confidence", action="store_true", help="Include confidence score and score components")
        command.add_argument("--format", choices=("json", "csv"), default="json")
        command.add_argument("--fuzzy", action="store_true", help="Enable explicitly lower-confidence fuzzy name matching")

    discover = sub.add_parser("discover", help="Discover likely chemical names/identifiers in free text")
    discover.add_argument("--input", required=True, help="Text file, or - for stdin")
    discover.add_argument("--to", default="all", help="Output namespace list or all")
    discover.add_argument("--confidence", action="store_true", help="Include confidence score and score components")
    discover.add_argument("--format", choices=("json", "csv"), default="json")
    discover.add_argument("--fuzzy", action="store_true", help="Enable explicitly lower-confidence fuzzy name matching")


    sync_state = sub.add_parser("sync-state", help="Initialize and inspect the Chemlake sync-state database")
    sync_state_sub = sync_state.add_subparsers(dest="sync_state_cmd")
    sync_state_sub.add_parser("init", help="Create or migrate sync-state tables")
    sync_state_sub.add_parser("status", help="Show sync-state table and status counts")

    sources = sub.add_parser("sources", help="Manage Chemlake source definitions")
    sources_sub = sources.add_subparsers(dest="sources_cmd")
    sources_import = sources_sub.add_parser("import", help="Import source definitions from a TSV file")
    sources_import.add_argument("--from", dest="from_path", required=True, help="TSV source registry, e.g. slurm/sources.tsv")
    sources_verify = sources_sub.add_parser("verify-adapters", help="Verify every registered source has a working adapter contract")
    sources_verify.add_argument("--from", dest="from_path", required=True, help="TSV source registry, e.g. slurm/sources.tsv")
    sources_live = sources_sub.add_parser("verify-live", help="Probe real remote datasource endpoints for adapters that support live checks")
    sources_live.add_argument("--from", dest="from_path", required=True, help="TSV source registry, e.g. slurm/sources.tsv")
    sources_plan = sources_sub.add_parser("plan-work", help="Plan enabled source work into Postgres remote_objects")
    sources_plan.add_argument("--from", dest="from_path", required=True, help="TSV source registry, e.g. slurm/sources.tsv")
    sources_plan.add_argument("--source", action="append", default=["all"], help="Source name, comma-list, or all; repeatable")
    sources_plan.add_argument("--include-pubchem", action="store_true", help="Also plan the pubchem registry row; normally PubChem FTP uses chemlake pubchem plan")
    sources_worker = sources_sub.add_parser("worker", help="Claim and download planned generic source work")
    sources_worker.add_argument("--source", required=True)
    sources_worker.add_argument("--worker-id", required=True)
    sources_worker.add_argument("--limit", type=int, default=1)
    sources_worker.add_argument("--root", default=os.environ.get("CHEMLAKE_ROOT", "."))

    sync = sub.add_parser("sync", help="Manage sync work queues and mirror status")
    sync_sub = sync.add_subparsers(dest="sync_cmd")
    pending = sync_sub.add_parser("pending", help="Claim pending accessions for a source")
    pending.add_argument("--source", required=True)
    pending.add_argument("--limit", type=int, default=100)
    pending.add_argument("--worker-id", default=None)
    downloaded = sync_sub.add_parser("mark-downloaded", help="Mark an accession as downloaded")
    downloaded.add_argument("--source", required=True)
    downloaded.add_argument("--accession", required=True)
    downloaded.add_argument("--local-path", required=True)
    downloaded.add_argument("--sha256")
    downloaded.add_argument("--size-bytes", type=int)
    failed = sync_sub.add_parser("mark-failed", help="Record a failed sync attempt and make it retryable")
    failed.add_argument("--source", required=True)
    failed.add_argument("--accession", required=True)
    failed.add_argument("--error", required=True)
    failed.add_argument("--next-attempt-at")
    report = sync_sub.add_parser("report", help="Report sync-state counts for a snapshot")
    report.add_argument("--snapshot", required=True)

    orchestrate = sub.add_parser("orchestrate", help="Keep Postgres-tracked ingestion jobs alive")
    orchestrate.add_argument("source", help="Source name, comma-list, or all")
    orchestrate.add_argument("--sources-from", default=os.environ.get("CHEMLAKE_SOURCES_TSV", ""), help="TSV registry used when source is all")
    orchestrate.add_argument("--snapshot", default="", help="Snapshot label; defaults to current UTC date")
    orchestrate.add_argument("--target-workers", type=int, default=4)
    orchestrate.add_argument("--stale-claim-minutes", type=int, default=90)
    orchestrate.add_argument("--stale-run-minutes", type=int, default=180)
    orchestrate.add_argument("--stale-claim-limit", type=int, default=500)
    orchestrate.add_argument("--worker-label-prefix", default="", help="Worker label prefix; defaults to <source>-worker")
    orchestrate.add_argument("--submit-command", default="", help="Shell command template using {source}, {worker_id}, and {snapshot}")
    orchestrate.add_argument("--dry-run", action="store_true", help="Read-only report; do not release claims, mark stale runs, submit jobs, or record runs")
    orchestrate.add_argument("--once", action="store_true", help="Run one orchestration pass and exit")
    orchestrate.add_argument("--poll-seconds", type=int, default=300)
    orchestrate.add_argument("--no-slurm-monitor", action="store_true", help="Disable sacct-based Slurm reconciliation")
    orchestrate.add_argument("--orchestrator-run-id", default="", help="Stable Postgres sync_runs id for the orchestration service heartbeat")
    orchestrate.add_argument("--orchestrator-job-id", default="", help="Hive/Slurm job id for the orchestration service")
    orchestrate.add_argument("--orchestrator-heartbeat-minutes", type=int, default=10, help="Maximum accepted service heartbeat age for worker guards")
    orchestrate.add_argument("--assert-service", action="store_true", help="Verify the named orchestrator service heartbeat is running and exit")

    pubchem = sub.add_parser("pubchem", help="Plan and execute PubChem FTP mirroring work")
    pubchem_sub = pubchem.add_subparsers(dest="pubchem_cmd")
    pubchem_list = pubchem_sub.add_parser("datasets", help="List supported PubChem FTP dataset groups")
    pubchem_list.add_argument("--format", choices=("json", "text"), default="text")
    pubchem_plan = pubchem_sub.add_parser("plan", help="Plan PubChem FTP files into Postgres remote_objects")
    pubchem_plan.add_argument("--dataset", action="append", default=[], help="Dataset name, comma-list, default, or all; repeatable; omitted means default")
    pubchem_plan.add_argument("--limit", type=int, default=0, help="Optional planning limit for staged rollouts/tests")
    pubchem_plan.add_argument("--max-depth", type=int, default=2, help="Maximum recursive index depth for recursive datasets")
    pubchem_worker = pubchem_sub.add_parser("worker", help="Claim and download planned PubChem FTP files")
    pubchem_worker.add_argument("--source", default="pubchem")
    pubchem_worker.add_argument("--worker-id", required=True)
    pubchem_worker.add_argument("--limit", type=int, default=1)
    pubchem_worker.add_argument("--root", default=os.environ.get("CHEMLAKE_ROOT", "."))

    metabolomics = sub.add_parser("metabolomics", help="Harvest and query metabolomics evidence")
    met_sub = metabolomics.add_subparsers(dest="met_cmd")
    harvest = met_sub.add_parser("harvest", help="Harvest processed metabolomics metadata/results")
    harvest.add_argument("--source", required=True, choices=("mw", "metabolights", "gnps", "metabolomexchange", "hub", "pubmed", "all"))
    harvest.add_argument("--accession", action="append", default=[], help="Study/dataset accession; repeatable")
    harvest.add_argument("--pmid", action="append", default=[], help="PubMed PMID; repeatable")
    mirror = met_sub.add_parser("mirror", help="Download full repository objects into a governed local mirror")
    mirror.add_argument("--source", required=True, choices=("mw", "metabolights", "gnps", "metabolomexchange", "hub", "all"))
    mirror.add_argument("--all", dest="all_data", action="store_true", help="Discover and mirror all public accessions for the source")
    mirror.add_argument("--accession", action="append", default=[], help="Study/dataset accession; repeatable")
    mirror.add_argument("--processed-only", action="store_true", help="Mirror metadata/processed endpoints but skip raw archive URLs")
    mirror.add_argument("--limit", type=int, help="Optional safety limit for testing or staged mirroring")
    met_sub.add_parser("index", help="Build DuckDB/Parquet metabolomics index")
    query = met_sub.add_parser("query", help="Query biological metabolomics contexts")
    query.add_argument("--compound")
    query.add_argument("--species")
    query.add_argument("--organ")
    query.add_argument("--genotype")
    query.add_argument("--disease")
    query.add_argument("--publication")
    query.add_argument("--format", choices=("json", "csv"), default="json")
    return parser


def main(argv: Optional[List[str]] = None, stdin: Optional[Iterable[str]] = None, stdout: Optional[TextIO] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.cmd:
        parser.print_help()
        return 2
    out = stdout or sys.stdout
    if args.cmd in {"sync-state", "sources", "sync"}:
        return _handle_sync_state_commands(args, out, parser)
    if args.cmd == "orchestrate":
        return _handle_orchestrate_command(args, out)
    if args.cmd == "pubchem":
        return _handle_pubchem_command(args, out, parser)
    if args.cmd == "metabolomics":
        if not args.data_dir:
            parser.error("--data-dir is required for metabolomics")
        data_dir = Path(args.data_dir)
        if args.met_cmd == "harvest":
            result = MetabolomicsHarvester().harvest(args.source, data_dir, accessions=args.accession, pmids=args.pmid)
            json.dump(result, out, indent=2, sort_keys=True)
            out.write("\n")
            return 0
        if args.met_cmd == "mirror":
            if not args.all_data and not args.accession:
                parser.error("metabolomics mirror requires --all or at least one --accession")
            result = MetabolomicsMirror().mirror(args.source, data_dir, all_data=args.all_data, accessions=args.accession, include_raw=not args.processed_only, limit=args.limit)
            json.dump(result, out, indent=2, sort_keys=True)
            out.write("\n")
            return 0
        if args.met_cmd == "index":
            index = MetabolomicsIndex.build(data_dir)
            json.dump({"index": str(index.db_path), "status": "built"}, out, indent=2, sort_keys=True)
            out.write("\n")
            return 0
        if args.met_cmd == "query":
            rows = MetabolomicsIndex(data_dir).query(compound=args.compound, species=args.species, organ=args.organ, genotype=args.genotype, disease=args.disease, publication=args.publication)
            _write_tabular_rows(rows, args.format, out)
            return 0
        return 2
    if not args.data_dir:
        parser.error("--data-dir is required for resolver commands")
    resolver = ChemlakeResolver.from_directory(Path(args.data_dir))
    if args.cmd in {"resolve", "translate"}:
        queries = _read_lines(args.input, stdin)
        if args.cmd == "translate":
            result = resolver.convert(
                queries,
                from_namespace=args.from_namespace,
                to=args.to,
                include_confidence=args.confidence,
                fuzzy=args.fuzzy,
            )
        else:
            result = resolver.resolve(
                queries,
                from_namespace=args.from_namespace,
                to=args.to,
                include_confidence=args.confidence,
                fuzzy=args.fuzzy,
            )
        _write_result(result, args.format, out)
        return 0
    if args.cmd == "discover":
        text = _read_text(args.input, stdin)
        result = resolver.discover(text, to=args.to, include_confidence=args.confidence, fuzzy=args.fuzzy)
        _write_result(result, args.format, out)
        return 0
    return 2


def _handle_pubchem_command(args, out: TextIO, parser: argparse.ArgumentParser) -> int:
    if args.pubchem_cmd == "datasets":
        if args.format == "json":
            json.dump({name: spec.__dict__ for name, spec in PUBCHEM_FTP_DATASETS.items()}, out, indent=2, sort_keys=True)
            out.write("\n")
        else:
            for name, spec in PUBCHEM_FTP_DATASETS.items():
                out.write(f"{name}\t{spec.path}\t{spec.description}\n")
        return 0
    config = SyncStateConfig.from_env()
    if config.backend != "postgres":
        json.dump({"error": "PubChem FTP production work requires CHEMLAKE_DB_BACKEND=postgres", "backend": config.backend}, out, indent=2, sort_keys=True)
        out.write("\n")
        return 2
    store = PostgresPubChemFtpStore(config.database_url)
    if args.pubchem_cmd == "plan":
        report = PubChemFtpPlanner(store).plan(datasets=args.dataset, limit=args.limit, max_depth=args.max_depth)
        json.dump(report, out, indent=2, sort_keys=True)
        out.write("\n")
        return 0
    if args.pubchem_cmd == "worker":
        report = PubChemFtpWorker(store, root=Path(args.root)).run_once(source=args.source, worker_id=args.worker_id, limit=args.limit)
        json.dump(report, out, indent=2, sort_keys=True)
        out.write("\n")
        return 0
    parser.error("pubchem requires datasets, plan, or worker")
    return 2


def _handle_sync_state_commands(args, out: TextIO, parser: argparse.ArgumentParser) -> int:
    if args.cmd == "sync-state":
        config = SyncStateConfig.from_env()
        state = connect_sync_state(config)
        if args.sync_state_cmd == "init":
            result = state.init_schema()
            result["backend"] = config.backend
            result["database_url"] = display_database_url(config.database_url)
            json.dump(result, out, indent=2, sort_keys=True)
            out.write("\n")
            return 0
        if args.sync_state_cmd == "status":
            result = state.status()
            json.dump(result, out, indent=2, sort_keys=True)
            out.write("\n")
            return 0
        parser.error("sync-state requires init or status")
    if args.cmd == "sources":
        if args.sources_cmd == "import":
            config = SyncStateConfig.from_env()
            state = connect_sync_state(config)
            state.init_schema()
            result = import_sources_tsv(state, Path(args.from_path))
            result["backend"] = config.backend
            json.dump(result, out, indent=2, sort_keys=True)
            out.write("\n")
            return 0
        if args.sources_cmd == "plan-work":
            config = SyncStateConfig.from_env()
            if config.backend != "postgres":
                json.dump({"error": "source work planning requires CHEMLAKE_DB_BACKEND=postgres", "backend": config.backend}, out, indent=2, sort_keys=True)
                out.write("\n")
                return 2
            rows = parse_sources_tsv(Path(args.from_path))
            report = SourceWorkPlanner(PostgresSourceWorkStore(config.database_url)).plan(
                rows=rows,
                sources=args.source,
                include_pubchem=args.include_pubchem,
            )
            json.dump(report, out, indent=2, sort_keys=True)
            out.write("\n")
            return 0
        if args.sources_cmd == "worker":
            config = SyncStateConfig.from_env()
            if config.backend != "postgres":
                json.dump({"error": "source workers require CHEMLAKE_DB_BACKEND=postgres", "backend": config.backend}, out, indent=2, sort_keys=True)
                out.write("\n")
                return 2
            report = SourceWorkWorker(PostgresSourceWorkStore(config.database_url), root=Path(args.root)).run_once(
                source=args.source,
                worker_id=args.worker_id,
                limit=args.limit,
            )
            json.dump(report, out, indent=2, sort_keys=True)
            out.write("\n")
            return 0
        if args.sources_cmd == "verify-adapters":
            result = verify_registered_adapters(parse_sources_tsv(Path(args.from_path)))
            json.dump(result, out, indent=2, sort_keys=True)
            out.write("\n")
            return 1 if result["missing_adapters"] or result["enabled_without_working_adapter"] else 0
        if args.sources_cmd == "verify-live":
            result = verify_live_adapters(parse_sources_tsv(Path(args.from_path)))
            json.dump(result, out, indent=2, sort_keys=True)
            out.write("\n")
            return 1 if result["summary"]["failed"] else 0
        parser.error("sources requires import, verify-adapters, verify-live, plan-work, or worker")
    if args.cmd == "sync":
        config = SyncStateConfig.from_env()
        state = connect_sync_state(config)
        if args.sync_cmd == "pending":
            rows = state.claim_pending(args.source, limit=args.limit, worker_id=args.worker_id)
            json.dump({"backend": config.backend, "source": args.source, "pending": rows}, out, indent=2, sort_keys=True)
            out.write("\n")
            return 0
        if args.sync_cmd == "mark-downloaded":
            row = state.mark_downloaded(
                args.source,
                args.accession,
                local_path=args.local_path,
                sha256=args.sha256,
                size_bytes=args.size_bytes,
            )
            json.dump(row, out, indent=2, sort_keys=True)
            out.write("\n")
            return 0
        if args.sync_cmd == "mark-failed":
            row = state.mark_failed(args.source, args.accession, args.error, next_attempt_at=args.next_attempt_at)
            json.dump(row, out, indent=2, sort_keys=True)
            out.write("\n")
            return 0
        if args.sync_cmd == "report":
            result = state.report(args.snapshot)
            json.dump(result, out, indent=2, sort_keys=True)
            out.write("\n")
            return 0
        parser.error("sync requires pending, mark-downloaded, mark-failed, or report")
    return 2


def _handle_orchestrate_command(args, out: TextIO) -> int:
    config = SyncStateConfig.from_env()
    if config.backend != "postgres":
        json.dump({"error": "orchestrate requires CHEMLAKE_DB_BACKEND=postgres", "backend": config.backend}, out, indent=2, sort_keys=True)
        out.write("\n")
        return 2
    try:
        sources = _resolve_orchestrator_sources(args.source, args.sources_from)
    except FileNotFoundError as exc:
        json.dump({"error": str(exc)}, out, indent=2, sort_keys=True)
        out.write("\n")
        return 2
    snapshot = args.snapshot or ""
    resolved_snapshot = snapshot or os.environ.get("CHEMLAKE_ORCH_SNAPSHOT", "").strip()
    if not resolved_snapshot:
        from datetime import datetime, timezone

        resolved_snapshot = datetime.now(timezone.utc).date().isoformat()
    orchestrator_job_id = args.orchestrator_job_id.strip() or os.environ.get("CHEMLAKE_ORCHESTRATOR_JOB_ID", "").strip() or os.environ.get("SLURM_JOB_ID", "").strip()
    orchestrator_run_id = args.orchestrator_run_id.strip() or os.environ.get("CHEMLAKE_ORCHESTRATOR_RUN_ID", "").strip()
    if args.assert_service:
        if not orchestrator_run_id:
            json.dump({"error": "--orchestrator-run-id or CHEMLAKE_ORCHESTRATOR_RUN_ID is required for --assert-service"}, out, indent=2, sort_keys=True)
            out.write("\n")
            return 2
        if len(sources) != 1:
            json.dump({"error": "--assert-service requires exactly one source", "sources": sources}, out, indent=2, sort_keys=True)
            out.write("\n")
            return 2
        try:
            result = PostgresOrchestrationStore(config.database_url).assert_orchestrator_running(
                run_id=orchestrator_run_id,
                source=sources[0],
                max_age_minutes=args.orchestrator_heartbeat_minutes,
            )
        except RuntimeError as exc:
            json.dump({"error": str(exc), "orchestrator_run_id": orchestrator_run_id, "source": sources[0]}, out, indent=2, sort_keys=True)
            out.write("\n")
            return 1
        json.dump(result, out, indent=2, sort_keys=True, default=str)
        out.write("\n")
        return 0
    submit_command = args.submit_command.strip() or os.environ.get("CHEMLAKE_ORCHESTRATOR_SUBMIT_COMMAND", "").strip()
    if not args.dry_run and not submit_command:
        json.dump({"error": "--submit-command or CHEMLAKE_ORCHESTRATOR_SUBMIT_COMMAND is required unless --dry-run is set"}, out, indent=2, sort_keys=True)
        out.write("\n")
        return 2
    if not args.dry_run:
        missing_placeholders = [name for name in ("{orchestrator_run_id}", "{orchestrator_job_id}") if name not in submit_command]
        if missing_placeholders:
            json.dump(
                {
                    "error": "submit command must include orchestration placeholders so workers depend on the running service: "
                    + ", ".join(missing_placeholders)
                },
                out,
                indent=2,
                sort_keys=True,
            )
            out.write("\n")
            return 2
        if not orchestrator_job_id:
            json.dump({"error": "--orchestrator-job-id, CHEMLAKE_ORCHESTRATOR_JOB_ID, or SLURM_JOB_ID is required for managed worker submission"}, out, indent=2, sort_keys=True)
            out.write("\n")
            return 2
    service = build_postgres_orchestration_service(config, submit_command, dry_run=args.dry_run, monitor_slurm=not args.no_slurm_monitor)

    def config_for(source: str) -> OrchestrationConfig:
        if orchestrator_run_id and len(sources) > 1:
            source_run_id = f"{orchestrator_run_id}:{source}"
        else:
            source_run_id = orchestrator_run_id or f"orchestrator:{source}:{resolved_snapshot}:{orchestrator_job_id or os.getpid()}"
        return OrchestrationConfig(
            source=source,
            snapshot=resolved_snapshot,
            target_workers=args.target_workers,
            stale_claim_minutes=args.stale_claim_minutes,
            stale_run_minutes=args.stale_run_minutes,
            stale_claim_limit=args.stale_claim_limit,
            worker_label_prefix=args.worker_label_prefix.strip() or f"{source}-worker",
            submit_command=submit_command,
            dry_run=args.dry_run,
            poll_seconds=args.poll_seconds,
            orchestrator_run_id=source_run_id,
            orchestrator_job_id=orchestrator_job_id,
        )
    if args.once:
        reports = [service.run_once(config_for(source)) for source in sources]
        payload = reports[0] if len(reports) == 1 else {"sources": sources, "reports": reports}
        json.dump(payload, out, indent=2, sort_keys=True)
        out.write("\n")
        return 0
    while True:
        for source in sources:
            json.dump(service.run_once(config_for(source)), out, indent=2, sort_keys=True)
            out.write("\n")
            out.flush()
        time.sleep(args.poll_seconds)
    return 0


def _resolve_orchestrator_sources(source_arg: str, sources_from: str = "") -> List[str]:
    requested = _split_csv_values([source_arg])
    if requested != ["all"]:
        return requested
    path = Path(sources_from).expanduser() if sources_from else Path("slurm/sources.tsv")
    if not path.is_file():
        raise FileNotFoundError(f"source registry TSV is required for orchestrate all: {path}")
    from .source_adapters import SOURCE_ADAPTERS, SourceAdapterStatus

    rows = parse_sources_tsv(path)
    selected = []
    for row in rows:
        source = str(row.get("source") or "").strip()
        adapter = SOURCE_ADAPTERS.get(source)
        if row.get("enabled") and adapter is not None and adapter.status is not SourceAdapterStatus.EXCLUDED:
            selected.append(source)
    return selected


def _split_csv_values(values: Iterable[str]) -> List[str]:
    result: List[str] = []
    for raw in values:
        for item in str(raw).split(","):
            item = item.strip()
            if item:
                result.append(item)
    return result or ["all"]


def _read_lines(input_path: str, stdin: Optional[Iterable[str]]) -> List[str]:
    if input_path == "-":
        iterable = stdin if stdin is not None else sys.stdin
        return [line.strip() for line in iterable if line.strip()]
    with open(input_path, "r", encoding="utf-8") as handle:
        return [line.strip() for line in handle if line.strip()]


def _read_text(input_path: str, stdin: Optional[Iterable[str]]) -> str:
    if input_path == "-":
        iterable = stdin if stdin is not None else sys.stdin
        return "".join(iterable)
    with open(input_path, "r", encoding="utf-8") as handle:
        return handle.read()


def _write_result(result, output_format: str, out: TextIO) -> None:
    if output_format == "json":
        json.dump(result, out, indent=2, sort_keys=True)
        out.write("\n")
        return
    _write_csv(result, out)


def _write_csv(result, out: TextIO) -> None:
    rows = []
    if "results" in result:
        for item in result["results"]:
            rows.append(_result_row(item))
    else:
        for item in result.get("discovered", []):
            row = _result_row(item["result"])
            row.update({"text": item["text"], "span": "{}-{}".format(*item["span"])})
            rows.append(row)
    fieldnames = sorted({key for row in rows for key in row}) or ["query", "found"]
    writer = csv.DictWriter(out, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)


def _write_tabular_rows(rows, output_format: str, out: TextIO) -> None:
    if output_format == "json":
        json.dump({"results": rows}, out, indent=2, sort_keys=True)
        out.write("\n")
        return
    fieldnames = sorted({key for row in rows for key in row}) or ["result"]
    writer = csv.DictWriter(out, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)


def _result_row(item):
    row = {
        "query": item.get("query"),
        "detected_query_type": item.get("detected_query_type"),
        "found": "true" if item.get("found") else "false",
    }
    if not item.get("matches"):
        return row
    best = item["matches"][0]
    row.update(
        {
            "compound_id": best.get("compound_id"),
            "preferred_name": best.get("preferred_name"),
            "match_level": best.get("match_level"),
        }
    )
    if "confidence" in best:
        row["confidence"] = best["confidence"]
    for key, value in best.get("outputs", {}).items():
        if isinstance(value, list):
            row[key] = ";".join(str(v) for v in value)
        elif isinstance(value, dict):
            row[key] = json.dumps(value, sort_keys=True)
        elif value is None:
            row[key] = ""
        else:
            row[key] = str(value)
    return row


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
