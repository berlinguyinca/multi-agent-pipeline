"""Small dependency-free REST-style handlers for Chemlake resolution.

These handlers are intentionally framework-neutral so a web server can delegate
POST /resolve, POST /discover, and POST /translate without adding request-time
network dependencies to the resolver itself.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from .resolver import ChemlakeResolver


def handle_post(path: str, payload: Dict[str, Any], resolver: ChemlakeResolver = None) -> Dict[str, Any]:
    resolver = resolver or ChemlakeResolver.from_directory(Path(payload["data_dir"]))
    endpoint = path.rstrip("/") or "/"
    try:
        if endpoint == "/resolve":
            queries = _payload_queries(payload)
            body = resolver.resolve(
                queries,
                from_namespace=payload.get("from", "auto"),
                to=payload.get("to", "all"),
                include_confidence=bool(payload.get("confidence", False)),
                fuzzy=bool(payload.get("fuzzy", False)),
            )
            return {"status": 200, "body": body}
        if endpoint == "/discover":
            body = resolver.discover(
                str(payload.get("text") or ""),
                to=payload.get("to", "all"),
                include_confidence=bool(payload.get("confidence", False)),
                fuzzy=bool(payload.get("fuzzy", False)),
            )
            return {"status": 200, "body": body}
        if endpoint == "/translate":
            body = resolver.convert(
                _payload_queries(payload),
                from_namespace=payload.get("from", "auto"),
                to=payload.get("to", "all"),
                include_confidence=bool(payload.get("confidence", False)),
                fuzzy=bool(payload.get("fuzzy", False)),
            )
            body["endpoint"] = "/resolve"
            return {"status": 200, "body": body}
        return {"status": 404, "body": {"error": f"unknown endpoint: {path}"}}
    except Exception as exc:  # pragma: no cover - defensive API boundary
        return {"status": 400, "body": {"error": str(exc)}}


def _payload_queries(payload: Dict[str, Any]):
    if "queries" in payload:
        queries = payload["queries"]
    else:
        queries = payload.get("query", [])
    if isinstance(queries, str):
        return [queries]
    return list(queries)
