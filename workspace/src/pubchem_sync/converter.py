"""Convert a normalized compound record into a Markdown document."""
from __future__ import annotations
import os
import tempfile
from pathlib import Path
from typing import Dict, Any, Iterable

_MANDATORY = ("cid", "smiles", "inchikey", "molecular_weight")


def _yaml_escape(v):
    s = str(v)
    if any(c in s for c in ':#"\n') or s != s.strip():
        return '"' + s.replace('"', '\\"') + '"'
    return s


def record_to_markdown(record: Dict[str, Any]) -> str:
    missing = [k for k in _MANDATORY if record.get(k) in (None, "")]
    if missing:
        raise ValueError(f"record missing mandatory field(s): {missing}")
    frontmatter = [
        f"cid: {int(record['cid'])}",
        f"smiles: {_yaml_escape(record['smiles'])}",
        f"inchikey: {_yaml_escape(record['inchikey'])}",
        f"molecular_weight: {record['molecular_weight']}",
    ]
    for key in ("preferred_name", "formula", "exact_mass", "monoisotopic_mass", "inchi"):
        if record.get(key) not in (None, ""):
            frontmatter.append(f"{key}: {_yaml_escape(record[key])}")
    lines = [
        "---",
        *frontmatter,
        "---",
        "",
        f"# Compound {int(record['cid'])}",
        "",
    ]
    _append_resolver_identity(lines, record)
    lines.extend([
        "## Properties",
        "",
        "| Property | Value |",
        "| --- | --- |",
    ])
    props = record.get("properties") or {}
    for k in sorted(props):
        v = props[k]
        display = str(v).replace("\n", " ").replace("|", "\\|")
        lines.append(f"| {k} | {display} |")
    lines.append("")
    return "\n".join(lines)


def _append_resolver_identity(lines: list, record: Dict[str, Any]) -> None:
    identity_rows = []
    if record.get("preferred_name"):
        identity_rows.append(("Preferred name", record["preferred_name"]))
    for key, label in (("formula", "Formula"), ("exact_mass", "Exact mass"), ("inchi", "InChI")):
        if record.get(key) not in (None, ""):
            identity_rows.append((label, record[key]))
    synonyms = record.get("synonyms") or []
    if synonyms:
        identity_rows.append(("Synonyms", _join_values(synonyms)))
    xrefs = record.get("xrefs") or {}
    for namespace in sorted(xrefs):
        identity_rows.append((f"Xref:{namespace}", _join_values(xrefs[namespace])))
    if not identity_rows:
        return
    lines.extend(["## Resolver Identity", "", "| Field | Value |", "| --- | --- |"])
    for key, value in identity_rows:
        display = str(value).replace("\n", " ").replace("|", "\\|")
        lines.append(f"| {key} | {display} |")
    lines.append("")


def _join_values(values: Iterable[Any]) -> str:
    if isinstance(values, str):
        return values
    return "; ".join(str(value) for value in values)


def write_markdown(record: Dict[str, Any], out_dir) -> Path:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    content = record_to_markdown(record)
    target = out_dir / f"{int(record['cid'])}.md"
    fd, tmp_path = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=str(out_dir))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(content)
        os.replace(tmp_path, target)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    return target
