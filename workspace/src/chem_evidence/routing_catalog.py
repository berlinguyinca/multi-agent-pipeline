"""Single source of truth for Chemlake resolver routing documentation."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List


@dataclass(frozen=True)
class SupportedDatabase:
    namespace: str
    label: str
    accepted_inputs: str
    artifact: str
    route: str
    output_fields: str
    notes: str = ""


SUPPORTED_DATABASES: List[SupportedDatabase] = [
    SupportedDatabase(
        "pubchem_cid",
        "PubChem Compound CID",
        "CID:2244, 2244, pubchem_cid:2244",
        "compound_identity.jsonl/parquet or xrefs.jsonl/parquet",
        "Xref index",
        "pubchem_cid plus all compound outputs",
        "Bare integers auto-detect as PubChem CID for CTS-Lite compatibility.",
    ),
    SupportedDatabase(
        "pubchem_sid",
        "PubChem Substance SID",
        "SID:12345, pubchem_sid:12345",
        "compound_identity.jsonl/parquet or xrefs.jsonl/parquet",
        "Xref index",
        "pubchem_sid plus all compound outputs",
    ),
    SupportedDatabase(
        "cas",
        "CAS-like registry number",
        "50-78-2, cas:50-78-2",
        "compound_identity.jsonl/parquet or xrefs.jsonl/parquet",
        "Xref index",
        "cas plus all compound outputs",
        "Only resolves when CAS-like values were ingested locally.",
    ),
    SupportedDatabase(
        "hmdb",
        "HMDB",
        "HMDB0001879, hmdb:HMDB0001879",
        "compound_identity.jsonl/parquet or xrefs.jsonl/parquet",
        "Xref index",
        "hmdb plus all compound outputs",
    ),
    SupportedDatabase(
        "chebi",
        "ChEBI",
        "CHEBI:15365, chebi:15365",
        "compound_identity.jsonl/parquet or xrefs.jsonl/parquet",
        "Xref index",
        "chebi plus all compound outputs",
    ),
    SupportedDatabase(
        "kegg",
        "KEGG Compound",
        "C01405, kegg:C01405",
        "compound_identity.jsonl/parquet or xrefs.jsonl/parquet",
        "Xref index",
        "kegg plus all compound outputs",
    ),
    SupportedDatabase(
        "lipidmaps",
        "LipidMaps",
        "LMFA01010001, lipidmaps:LMFA01010001",
        "compound_identity.jsonl/parquet or xrefs.jsonl/parquet",
        "Xref index",
        "lipidmaps plus all compound outputs",
    ),
    SupportedDatabase(
        "drugbank",
        "DrugBank",
        "DB00945, drugbank:DB00945",
        "compound_identity.jsonl/parquet or xrefs.jsonl/parquet",
        "Xref index",
        "drugbank plus all compound outputs",
    ),
    SupportedDatabase(
        "comptox",
        "EPA CompTox / DSSTox",
        "DTXSID5020108, DTXCID..., comptox:DTXSID...",
        "compound_identity.jsonl/parquet or xrefs.jsonl/parquet",
        "Xref index",
        "comptox plus all compound outputs",
    ),
    SupportedDatabase(
        "splash",
        "SPLASH / spectra sources",
        "splash10-...",
        "spectra.jsonl/parquet",
        "Spectra index",
        "splash, spectra, and linked compound outputs",
        "SPLASH routes through spectra artifacts, then joins to compound identity.",
    ),
    SupportedDatabase(
        "name",
        "Preferred names and synonyms",
        "aspirin, acetylsalicylic acid",
        "compound_identity.jsonl/parquet and synonyms.jsonl/parquet",
        "Name dictionary index",
        "names, synonyms, and all compound outputs",
        "Exact name/synonym matching is default; fuzzy matching is opt-in and lower confidence.",
    ),
    SupportedDatabase(
        "structure",
        "Structure identifiers",
        "InChI, InChIKey, SMILES",
        "compound_identity.jsonl/parquet",
        "Structure index",
        "inchi, inchikey, smiles, formula, mass, SDF/molfile when present",
    ),
    SupportedDatabase(
        "formula",
        "Molecular formula",
        "C9H8O4",
        "compound_identity.jsonl/parquet",
        "Formula fallback index",
        "formula plus ranked candidate compound outputs",
        "Formula-only matches are intentionally lower confidence because they are often ambiguous.",
    ),
    SupportedDatabase(
        "inchikey_block1",
        "InChIKey first block",
        "BSYNRYMUTXBXSQ",
        "compound_identity.jsonl/parquet",
        "Structure fallback index",
        "inchikey plus ranked candidate compound outputs",
        "Connectivity-only fallback; lower confidence than full InChIKey.",
    ),
]

_ROUTE_DESCRIPTIONS = {
    "Xref index": "Source/database identifiers normalized by namespace and joined to compound identity.",
    "Name dictionary index": "Preferred names and synonyms normalized for exact dictionary lookup; optional fuzzy fallback is explicit.",
    "Structure index": "Exact InChI, InChIKey, and SMILES fields from local identity artifacts.",
    "Formula fallback index": "Formula-only candidate set with ambiguity-aware lower confidence.",
    "Structure fallback index": "First-block InChIKey candidate set with lower confidence than exact structure matches.",
    "Spectra index": "SPLASH/spectral identifiers joined from spectra artifacts to compounds.",
}

_OUTPUT_NODES = [
    "Identifiers + xrefs",
    "Structures + formula/mass",
    "Names + synonyms",
    "Spectra",
    "Evidence + usage/commonness",
    "Provenance + freshness",
]

_GENERATED_NOTICE = "<!-- generated by scripts/generate_resolver_docs.py; edit src/chem_evidence/routing_catalog.py -->"


def render_mermaid(databases: Iterable[SupportedDatabase] = SUPPORTED_DATABASES) -> str:
    databases = list(databases)
    lines = [
        "graph LR",
        "  Query[Mixed query or free text] --> Classifier[Query classifier]",
        "  Discover[Text discovery] --> Classifier",
        "  subgraph Supported input databases and identifier families",
    ]
    for item in databases:
        lines.append(f"    {node_id('db_' + item.namespace)}[{_escape_label(item.label)}]")
    lines.extend(
        [
            "  end",
            "  subgraph Resolver indexes",
        ]
    )
    for route in _unique(item.route for item in databases):
        lines.append(f"    {node_id('route_' + route)}[{_escape_label(route)}]")
    lines.extend(
        [
            "  end",
            "  subgraph Local lake artifacts",
            "    Identity[(compound_identity JSONL/Parquet)]",
            "    Xrefs[(xrefs JSONL/Parquet)]",
            "    Synonyms[(synonyms JSONL/Parquet)]",
            "    Spectra[(spectra JSONL/Parquet)]",
            "    Evidence[(evidence JSONL/Parquet)]",
            "    Manifest[(manifest/freshness JSON)]",
            "  end",
        ]
    )
    for item in databases:
        lines.append(f"  Classifier --> {node_id('db_' + item.namespace)}")
        lines.append(f"  {node_id('db_' + item.namespace)} --> {node_id('route_' + item.route)}")
    lines.extend(
        [
            "  Identity --> route_Structure_index",
            "  Identity --> route_Formula_fallback_index",
            "  Identity --> route_Structure_fallback_index",
            "  Xrefs --> route_Xref_index",
            "  Synonyms --> route_Name_dictionary_index",
            "  Spectra --> route_Spectra_index",
            "  Evidence --> Knowledge[Knowledge enrichment]",
            "  Manifest --> Knowledge",
        ]
    )
    for route in _unique(item.route for item in databases):
        lines.append(f"  {node_id('route_' + route)} --> Merge[Candidate merge]")
    lines.extend(
        [
            "  Merge --> Rank[Ambiguity-aware ranking]",
            "  Rank --> Confidence[Optional confidence score/components]",
            "  Confidence --> Matches[Ranked Chemlake matches]",
            "  Knowledge --> Matches",
            "  Matches --> AllOutputs{Requested outputs}",
        ]
    )
    for output in _OUTPUT_NODES:
        lines.append(f"  AllOutputs --> {node_id('out_' + output)}[{_escape_label(output)}]")
    lines.append("  Matches --> NotAvailable[Explicit not-available-locally warnings for unsupported NCI/CADD hashes]")
    return "\n".join(lines)


def render_markdown(databases: Iterable[SupportedDatabase] = SUPPORTED_DATABASES) -> str:
    databases = list(databases)
    lines = [
        _GENERATED_NOTICE,
        "",
        "# Chemlake resolver database routing",
        "",
        "This document is generated from `src/chem_evidence/routing_catalog.py`. To update the graph or supported database table, edit that catalog and run:",
        "",
        "```bash",
        "python scripts/generate_resolver_docs.py",
        "```",
        "",
        "## Routing graph",
        "",
        "```mermaid",
        render_mermaid(databases),
        "```",
        "",
        "## Supported databases and identifier families",
        "",
        "| Namespace | Database / family | Accepted inputs | Local artifact(s) | Resolver route | Outputs | Notes |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for item in databases:
        lines.append(
            "| {namespace} | {label} | {inputs} | {artifact} | {route} | {outputs} | {notes} |".format(
                namespace=_md(item.namespace),
                label=_md(item.label),
                inputs=_md(item.accepted_inputs),
                artifact=_md(item.artifact),
                route=_md(item.route),
                outputs=_md(item.output_fields),
                notes=_md(item.notes or "—"),
            )
        )
    lines.extend(
        [
            "",
            "## Route semantics",
            "",
        ]
    )
    for route, description in _ROUTE_DESCRIPTIONS.items():
        lines.append(f"- **{route}** — {description}")
    lines.extend(
        [
            "",
            "All request-time routing is local/offline. Remote services such as CACTUS, PubChem, CTS, HMDB, ChEBI, KEGG, LipidMaps, DrugBank, and CompTox are ingestion/backfill sources only; they are not called during `resolve`, `discover`, or `translate`.",
        ]
    )
    return "\n".join(lines)


def render_database_index(databases: Iterable[SupportedDatabase] = SUPPORTED_DATABASES) -> str:
    databases = list(databases)
    lines = [
        _GENERATED_NOTICE,
        "",
        "# Chemlake resolver database READMEs",
        "",
        "Each database/identifier-family README in this directory is generated from `src/chem_evidence/routing_catalog.py`.",
        "",
        "Update flow:",
        "",
        "```bash",
        "python scripts/generate_resolver_docs.py",
        "```",
        "",
        "## Database READMEs",
        "",
    ]
    for item in databases:
        lines.append(f"- [{item.label} (`{item.namespace}`)]({item.namespace}/README.md) — routes through **{item.route}**")
    return "\n".join(lines)


def render_database_readme(item: SupportedDatabase) -> str:
    route_description = _ROUTE_DESCRIPTIONS.get(item.route, "Resolver route documented in the routing catalog.")
    lines = [
        _GENERATED_NOTICE,
        "",
        f"# {item.label}",
        "",
        f"Namespace: `{item.namespace}`",
        "",
        "## What this supports",
        "",
        f"Chemlake resolves {item.label} queries from local lake data and returns ranked compound matches. Request-time resolution is offline; this route never calls an upstream service.",
        "",
        "## Accepted inputs",
        "",
        f"`{item.accepted_inputs}`",
        "",
        "## Local artifact requirements",
        "",
        f"- `{item.artifact}`",
        "",
        "The artifact must contain values that can be normalized into this namespace and joined to a Chemlake compound identity.",
        "",
        "## Resolver route",
        "",
        f"- Route: **{item.route}**",
        f"- Behavior: {route_description}",
        "- Ranking: candidates are merged with other matching routes, then scored with ambiguity-aware confidence components when `--confidence` is requested.",
        "",
        "## Outputs",
        "",
        f"{item.output_fields}.",
        "",
        "When `--to all` is requested, this route can also return linked names, synonyms, structures, source xrefs, spectra, evidence summaries, usage/commonness, provenance, and freshness when those fields are available locally.",
        "",
        "## CLI examples",
        "",
        "```bash",
        f"chemlake --data-dir ./lake resolve --input queries.txt --from {item.namespace} --to all --confidence",
        f"printf '%s\n' '{_first_example(item.accepted_inputs)}' | chemlake --data-dir ./lake resolve --input - --to all --confidence",
        "```",
        "",
        "## API example",
        "",
        "```json",
        "{",
        f"  \"queries\": [\"{_first_example(item.accepted_inputs)}\"],",
        f"  \"from\": \"{item.namespace}\",",
        "  \"to\": \"all\",",
        "  \"confidence\": true",
        "}",
        "```",
        "",
        "## Notes",
        "",
        item.notes or "No additional caveats beyond local artifact availability.",
        "",
        "## Updating this README",
        "",
        "Do not edit this file directly. Edit `src/chem_evidence/routing_catalog.py`, then run `python scripts/generate_resolver_docs.py`.",
    ]
    return "\n".join(lines)


def render_svg(databases: Iterable[SupportedDatabase] = SUPPORTED_DATABASES) -> str:
    """Render a presentation-friendly deterministic SVG routing graph."""

    databases = list(databases)
    routes = _unique(item.route for item in databases)
    width = 1800
    row_height = 74
    top = 150
    height = max(980, top + max(len(databases), len(routes) + len(_OUTPUT_NODES)) * row_height + 180)
    db_x, route_x, merge_x, output_x = 70, 600, 990, 1290
    box_w, route_w, small_w = 380, 290, 390
    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#f8fafc"/>',
        '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#475569"/></marker></defs>',
        '<style>text{font-family:Inter,Arial,sans-serif}.title{font-size:34px;font-weight:700;fill:#0f172a}.subtitle{font-size:16px;fill:#475569}.head{font-size:20px;font-weight:700;fill:#0f172a}.label{font-size:15px;fill:#0f172a}.small{font-size:12px;fill:#475569}.box{stroke:#334155;stroke-width:1.4;rx:14;ry:14}.db{fill:#dbeafe}.route{fill:#dcfce7}.merge{fill:#fef3c7}.out{fill:#fce7f3}.artifact{fill:#ede9fe}</style>',
        '<text x="70" y="58" class="title">Chemlake resolver database routing</text>',
        '<text x="70" y="90" class="subtitle">Local/offline query classification → resolver indexes → ranked matches → requested outputs</text>',
        '<text x="70" y="128" class="head">Supported inputs</text>',
        '<text x="600" y="128" class="head">Resolver route</text>',
        '<text x="990" y="128" class="head">Ranking</text>',
        '<text x="1290" y="128" class="head">Outputs</text>',
    ]

    route_positions = {route: top + index * row_height for index, route in enumerate(routes)}
    for index, item in enumerate(databases):
        y = top + index * row_height
        svg.append(_svg_box(db_x, y, box_w, 52, item.label, item.namespace, "db"))
        route_y = route_positions[item.route]
        svg.append(_svg_line(db_x + box_w, y + 26, route_x, route_y + 26))
    for route, y in route_positions.items():
        svg.append(_svg_box(route_x, y, route_w, 52, route, _ROUTE_DESCRIPTIONS.get(route, ""), "route"))
        svg.append(_svg_line(route_x + route_w, y + 26, merge_x, top + 170))

    svg.append(_svg_box(merge_x, top + 115, small_w, 52, "Candidate merge", "dedupe across routes", "merge"))
    svg.append(_svg_box(merge_x, top + 195, small_w, 52, "Ambiguity-aware ranking", "match level + source/evidence boosts", "merge"))
    svg.append(_svg_box(merge_x, top + 275, small_w, 52, "Optional confidence", "score and components", "merge"))
    svg.append(_svg_line(merge_x + 195, top + 167, merge_x + 195, top + 195))
    svg.append(_svg_line(merge_x + 195, top + 247, merge_x + 195, top + 275))

    output_start = top
    for index, output in enumerate(_OUTPUT_NODES):
        y = output_start + index * row_height
        svg.append(_svg_box(output_x, y, small_w, 52, output, "returned when requested/available", "out"))
        svg.append(_svg_line(merge_x + small_w, top + 301, output_x, y + 26))
    unavailable_y = output_start + len(_OUTPUT_NODES) * row_height
    svg.append(_svg_box(output_x, unavailable_y, small_w, 58, "Local-unavailable warnings", "unsupported NCI/CADD hashes", "out"))
    svg.append(_svg_line(merge_x + small_w, top + 301, output_x, unavailable_y + 29))

    artifact_y = height - 145
    artifact_labels = [
        "compound_identity JSONL/Parquet",
        "xrefs JSONL/Parquet",
        "synonyms JSONL/Parquet",
        "spectra JSONL/Parquet",
        "evidence + manifest/freshness",
    ]
    svg.append(f'<text x="70" y="{artifact_y - 20}" class="head">Local lake artifacts feeding the indexes</text>')
    artifact_w = 310
    for index, label in enumerate(artifact_labels):
        x = 70 + index * 340
        svg.append(_svg_box(x, artifact_y, artifact_w, 56, label, "offline data product", "artifact"))
    svg.append("</svg>")
    return "\n".join(svg)


def node_id(value: str) -> str:
    normalized = "".join(ch if ch.isalnum() else "_" for ch in value)
    while "__" in normalized:
        normalized = normalized.replace("__", "_")
    return normalized.strip("_")


def _unique(values: Iterable[str]) -> List[str]:
    seen = set()
    out = []
    for value in values:
        if value not in seen:
            out.append(value)
            seen.add(value)
    return out


def _escape_label(value: str) -> str:
    return value.replace('"', "'")


def _first_example(accepted_inputs: str) -> str:
    return accepted_inputs.split(",", 1)[0].strip()


def _xml(value: str) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _svg_box(x: int, y: int, width: int, height: int, title: str, subtitle: str, klass: str) -> str:
    return (
        f'<g><rect class="box {klass}" x="{x}" y="{y}" width="{width}" height="{height}"/>'
        f'<text x="{x + 16}" y="{y + 22}" class="label">{_xml(_truncate(title, 44))}</text>'
        f'<text x="{x + 16}" y="{y + 42}" class="small">{_xml(_truncate(subtitle, 56))}</text></g>'
    )


def _svg_line(x1: int, y1: int, x2: int, y2: int) -> str:
    mid = (x1 + x2) // 2
    return f'<path d="M{x1},{y1} C{mid},{y1} {mid},{y2} {x2},{y2}" fill="none" stroke="#475569" stroke-width="1.5" marker-end="url(#arrow)" opacity="0.78"/>'


def _truncate(value: str, max_len: int) -> str:
    text = str(value)
    return text if len(text) <= max_len else text[: max_len - 1] + "…"


def _md(value: str) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")
