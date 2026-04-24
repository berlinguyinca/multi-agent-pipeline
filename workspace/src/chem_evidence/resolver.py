"""Offline Chemlake chemical identifier resolver.

The resolver intentionally does not call PubChem, CACTUS, CTS, or any other
request-time network service.  It builds local indexes over lake artifacts and
reports explicit warnings when an output representation is not available from
local data.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


@dataclass(frozen=True)
class QueryType:
    """Detected query namespace and normalized value."""

    namespace: str
    value: str
    valid: bool = True
    reason: Optional[str] = None


@dataclass
class ChemicalRecord:
    """Normalized Chemlake compound identity with optional rich evidence."""

    compound_id: str
    preferred_name: str
    synonyms: List[str] = field(default_factory=list)
    xrefs: Dict[str, List[str]] = field(default_factory=dict)
    formula: Optional[str] = None
    exact_mass: Optional[float] = None
    monoisotopic_mass: Optional[float] = None
    inchi: Optional[str] = None
    inchikey: Optional[str] = None
    smiles: Optional[str] = None
    molfile: Optional[str] = None
    sdf: Optional[str] = None
    spectra: List[Dict[str, Any]] = field(default_factory=list)
    evidence: Dict[str, Any] = field(default_factory=dict)
    provenance: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def all_names(self) -> List[str]:
        names: List[str] = []
        if self.preferred_name:
            names.append(self.preferred_name)
        names.extend(self.synonyms)
        return _dedupe_preserve_order([n for n in names if n])


@dataclass
class _Candidate:
    record: ChemicalRecord
    match_level: str
    base_score: float
    matched_value: str
    matched_namespace: str
    provenance: List[Dict[str, Any]] = field(default_factory=list)


_IDENTIFIER_PREFIXES = {
    "cid": "pubchem_cid",
    "pubchem_cid": "pubchem_cid",
    "sid": "pubchem_sid",
    "pubchem_sid": "pubchem_sid",
    "hmdb": "hmdb",
    "chebi": "chebi",
    "kegg": "kegg",
    "lm": "lipidmaps",
    "lipidmaps": "lipidmaps",
    "drugbank": "drugbank",
    "db": "drugbank",
    "comptox": "comptox",
    "dsstox": "comptox",
    "cas": "cas",
}

_INCHIKEY_RE = re.compile(r"^[A-Z]{14}-[A-Z]{10}-[A-Z]$", re.IGNORECASE)
_INCHIKEY_BLOCK1_RE = re.compile(r"^[A-Z]{14}$", re.IGNORECASE)
_MALFORMED_INCHIKEY_RE = re.compile(r"^[A-Z]{14}-[A-Z]{1,10}(-[A-Z]?)?$", re.IGNORECASE)
_CAS_RE = re.compile(r"^\d{2,7}-\d{2}-\d$")
_HMDB_RE = re.compile(r"^HMDB\d{5,}$", re.IGNORECASE)
_CHEBI_RE = re.compile(r"^(?:CHEBI:)?\d{2,7}$", re.IGNORECASE)
_KEGG_RE = re.compile(r"^C\d{5}$", re.IGNORECASE)
_LIPIDMAPS_RE = re.compile(r"^LM[A-Z]{2}\d{8,}$", re.IGNORECASE)
_DRUGBANK_RE = re.compile(r"^DB\d{5}$", re.IGNORECASE)
_COMPTOX_RE = re.compile(r"^(?:DTXSID|DTXCID)\d+$", re.IGNORECASE)
_SPLASH_RE = re.compile(r"^splash\d{2}-[A-Za-z0-9-]+$", re.IGNORECASE)
_FORMULA_RE = re.compile(r"^(?:[A-Z][a-z]?\d*){2,}$")
_SMILES_HINT_RE = re.compile(r"[=#@\[\]\(\)\\/]|[A-Z][a-z]?\d?[+-]")
_PREFIX_RE = re.compile(r"^([A-Za-z_]+):(.+)$")
_TOKEN_RE = re.compile(
    r"\b(?:CID:\d+|SID:\d+|HMDB\d{5,}|CHEBI:\d+|C\d{5}|LM[A-Z]{2}\d{8,}|DB\d{5}|"
    r"DTXSID\d+|DTXCID\d+|\d{2,7}-\d{2}-\d|[A-Z]{14}-[A-Z]{10}-[A-Z]|"
    r"splash\d{2}-[A-Za-z0-9-]+)\b",
    re.IGNORECASE,
)


_OUTPUT_ALIASES = {
    "cid": "pubchem_cid",
    "sid": "pubchem_sid",
    "name": "names",
    "synonym": "synonyms",
    "synonyms": "synonyms",
    "names": "names",
    "inchi": "inchi",
    "standard_inchi": "inchi",
    "inchikey": "inchikey",
    "smiles": "smiles",
    "formula": "formula",
    "exact_mass": "exact_mass",
    "monoisotopic_mass": "monoisotopic_mass",
    "molfile": "molfile",
    "sdf": "sdf",
    "xrefs": "xrefs",
    "spectra": "spectra",
    "evidence": "evidence",
    "provenance": "provenance",
    "freshness": "freshness",
    "pubchem_cid": "pubchem_cid",
    "pubchem_sid": "pubchem_sid",
    "hmdb": "hmdb",
    "chebi": "chebi",
    "kegg": "kegg",
    "lipidmaps": "lipidmaps",
    "drugbank": "drugbank",
    "comptox": "comptox",
    "dsstox": "comptox",
    "cas": "cas",
    "splash": "splash",
}

_LOCAL_ONLY_PLACEHOLDERS = {
    "ficts": "NCI/CADD FICTS is not available locally; algorithm/data not implemented",
    "ficus": "NCI/CADD FICuS is not available locally; algorithm/data not implemented",
    "uuuuu": "NCI/CADD uuuuu is not available locally; algorithm/data not implemented",
    "hashisy": "NCI/CADD HASHISY is not available locally; algorithm/data not implemented",
    "nci_hash": "NCI-style hash identifier is not available locally; algorithm/data not implemented",
}


def classify_query(query: str, declared_namespace: str = "auto") -> QueryType:
    """Classify a CTS-Lite/CACTUS-like query string into a local namespace."""

    raw = str(query or "").strip()
    if not raw:
        return QueryType("unknown", raw, False, "empty query")

    declared = _normalize_namespace(declared_namespace)
    if declared and declared != "auto":
        return QueryType(declared, _strip_known_prefix(raw, declared), _validate_for_namespace(raw, declared))

    prefix_match = _PREFIX_RE.match(raw)
    if prefix_match:
        prefix = prefix_match.group(1).lower()
        value = prefix_match.group(2).strip()
        namespace = _IDENTIFIER_PREFIXES.get(prefix)
        if namespace:
            return QueryType(namespace, value, _validate_for_namespace(value, namespace))
        if prefix == "inchi":
            # InChI strings are the one common chemical identifier where the
            # namespace prefix is part of the value and should be preserved.
            return QueryType("inchi", raw, raw.startswith("InChI="))

    if raw.startswith("InChI="):
        return QueryType("inchi", raw, bool(re.match(r"^InChI=\d*S?/.+", raw)))
    if _INCHIKEY_RE.match(raw):
        return QueryType("inchikey", raw.upper())
    if _MALFORMED_INCHIKEY_RE.match(raw) and not _INCHIKEY_RE.match(raw):
        return QueryType("inchikey", raw.upper(), False, "malformed InChIKey")
    if _INCHIKEY_BLOCK1_RE.match(raw):
        return QueryType("inchikey_block1", raw.upper())
    if _SPLASH_RE.match(raw):
        return QueryType("splash", raw)
    if _CAS_RE.match(raw):
        return QueryType("cas", raw)
    if _HMDB_RE.match(raw):
        return QueryType("hmdb", raw.upper())
    if raw.upper().startswith("CHEBI:"):
        return QueryType("chebi", _normalize_identifier("chebi", raw))
    if _KEGG_RE.match(raw):
        return QueryType("kegg", raw.upper())
    if _LIPIDMAPS_RE.match(raw):
        return QueryType("lipidmaps", raw.upper())
    if _DRUGBANK_RE.match(raw):
        return QueryType("drugbank", raw.upper())
    if _COMPTOX_RE.match(raw):
        return QueryType("comptox", raw.upper())
    if raw.isdigit():
        return QueryType("pubchem_cid", raw)
    if _FORMULA_RE.match(raw) and any(ch.isdigit() for ch in raw):
        return QueryType("formula", _normalize_formula(raw))
    if _looks_like_smiles(raw):
        return QueryType("smiles", raw)
    return QueryType("name", raw)


class ChemlakeResolver:
    """Local/offline universal chemical identifier resolver."""

    def __init__(self, records: Iterable[ChemicalRecord], freshness: Optional[Dict[str, Any]] = None):
        self.records = list(records)
        self.freshness = freshness or {}
        self._by_identifier: Dict[Tuple[str, str], List[Tuple[ChemicalRecord, Dict[str, Any]]]] = {}
        self._by_structure: Dict[Tuple[str, str], List[ChemicalRecord]] = {}
        self._by_name: Dict[str, List[ChemicalRecord]] = {}
        self._name_display: Dict[str, str] = {}
        self._index_records()

    @classmethod
    def from_directory(cls, data_dir: Path) -> "ChemlakeResolver":
        """Build a resolver from common Chemlake JSONL artifacts in a directory."""

        data_path = Path(data_dir)
        records_by_id: Dict[str, ChemicalRecord] = {}
        identity_files = [
            "compound_identity.jsonl",
            "compounds.jsonl",
            "identity.jsonl",
            "records.jsonl",
        ]
        for filename in identity_files:
            for row in _read_rows_if_exists(data_path / filename):
                record = _record_from_row(row)
                records_by_id[record.compound_id] = record

        for row in _read_rows_if_exists(data_path / "xrefs.jsonl"):
            record = _record_for_related_row(records_by_id, row)
            if record is None:
                continue
            namespace = _normalize_namespace(str(row.get("namespace") or row.get("source") or ""))
            identifier = row.get("identifier") or row.get("id") or row.get("value")
            if namespace and identifier:
                _append_unique(record.xrefs.setdefault(namespace, []), str(identifier))
            provenance = {k: v for k, v in row.items() if k not in {"compound_id", "namespace", "identifier"}}
            if provenance:
                provenance.setdefault("namespace", namespace)
                provenance.setdefault("identifier", identifier)
                record.provenance.append(provenance)

        for row in _read_rows_if_exists(data_path / "synonyms.jsonl"):
            record = _record_for_related_row(records_by_id, row)
            name = row.get("name") or row.get("synonym") or row.get("value")
            if record is not None and name:
                _append_unique(record.synonyms, str(name))
                source = row.get("source")
                if source:
                    record.provenance.append({"source": source, "field": "synonym", "value": name})

        for row in _read_rows_if_exists(data_path / "spectra.jsonl"):
            record = _record_for_related_row(records_by_id, row)
            if record is not None:
                record.spectra.append(dict(row))

        for row in _read_rows_if_exists(data_path / "evidence.jsonl"):
            record = _record_for_related_row(records_by_id, row)
            if record is not None:
                for key, value in row.items():
                    if key not in {"compound_id", "id"}:
                        record.evidence[key] = value

        try:
            from .metabolomics import enrich_record_with_metabolomics

            for record in records_by_id.values():
                enrich_record_with_metabolomics(record, data_path)
        except Exception:
            # Metabolomics enrichment is optional; resolver operation should not
            # fail when its analytical index/dependencies are absent.
            pass

        freshness = _read_json_if_exists(data_path / "manifest.json")
        if not freshness:
            freshness = _read_json_if_exists(data_path / "freshness.json")
        return cls(records_by_id.values(), freshness=freshness)

    def resolve(
        self,
        queries: Iterable[str],
        from_namespace: str = "auto",
        to: Any = "all",
        include_confidence: bool = False,
        include_knowledge: bool = True,
        fuzzy: bool = False,
    ) -> Dict[str, Any]:
        return {
            "endpoint": "/resolve",
            "results": [
                self.resolve_one(
                    query,
                    from_namespace=from_namespace,
                    to=to,
                    include_confidence=include_confidence,
                    include_knowledge=include_knowledge,
                    fuzzy=fuzzy,
                )
                for query in queries
            ],
        }

    def resolve_one(
        self,
        query: str,
        from_namespace: str = "auto",
        to: Any = "all",
        include_confidence: bool = False,
        include_knowledge: bool = True,
        fuzzy: bool = False,
    ) -> Dict[str, Any]:
        detected = classify_query(query, from_namespace)
        requested_outputs = _parse_outputs(to)
        candidates = self._find_candidates(detected, fuzzy=fuzzy)
        candidates.sort(key=lambda candidate: self._score_candidate(candidate, detected)[0], reverse=True)
        ambiguous = len(candidates) > 1 and candidates[0].matched_namespace in {"name", "synonym"}
        result: Dict[str, Any] = {
            "query": query,
            "detected_query_type": detected.namespace,
            "normalized_query": detected.value,
            "found": bool(candidates),
            "requested_outputs": requested_outputs if requested_outputs != ["all"] else "all",
            "matches": [],
            "warnings": [],
        }
        if not detected.valid:
            result["warnings"].append(detected.reason or "query did not validate for detected namespace")
        if ambiguous:
            result["warnings"].append("ambiguous query matched multiple compounds")

        for candidate in candidates:
            score, components = self._score_candidate(candidate, detected, ambiguous=ambiguous)
            warnings: List[str] = []
            outputs = _record_outputs(candidate.record, requested_outputs, warnings)
            match: Dict[str, Any] = {
                "compound_id": candidate.record.compound_id,
                "preferred_name": candidate.record.preferred_name,
                "match_level": candidate.match_level,
                "matched_namespace": candidate.matched_namespace,
                "matched_value": candidate.matched_value,
                "outputs": outputs,
                "warnings": warnings,
                "provenance": candidate.provenance or candidate.record.provenance,
            }
            if include_confidence:
                match["confidence"] = score
                match["score_components"] = components
            if include_knowledge:
                match["knowledge"] = _record_knowledge(candidate.record, self.freshness)
            result["matches"].append(match)
        return result

    def discover(
        self,
        text: str,
        to: Any = "all",
        include_confidence: bool = False,
        fuzzy: bool = False,
    ) -> Dict[str, Any]:
        spans = self._discover_spans(text)
        discovered = []
        for start, end, value in spans:
            resolved = self.resolve_one(value, to=to, include_confidence=include_confidence, fuzzy=fuzzy)
            if resolved["found"]:
                discovered.append(
                    {
                        "text": value,
                        "span": [start, end],
                        "detected_query_type": resolved["detected_query_type"],
                        "result": resolved,
                    }
                )
        return {"endpoint": "/discover", "query": text, "discovered": discovered}

    def convert(self, queries: Iterable[str], **kwargs: Any) -> Dict[str, Any]:
        result = self.resolve(queries, **kwargs)
        result["compatibility_alias"] = "translate"
        return result

    def _index_records(self) -> None:
        for record in self.records:
            for namespace, identifiers in record.xrefs.items():
                normalized_namespace = _normalize_namespace(namespace)
                for identifier in identifiers:
                    self._add_identifier(normalized_namespace, identifier, record, {"field": "xrefs"})
            for field_name in ["inchi", "inchikey", "smiles", "formula"]:
                value = getattr(record, field_name)
                if value:
                    key_value = _normalize_identifier(field_name, value)
                    self._by_structure.setdefault((field_name, key_value), []).append(record)
            if record.inchikey:
                self._by_structure.setdefault(("inchikey_block1", record.inchikey[:14].upper()), []).append(record)
            for spectrum in record.spectra:
                splash = spectrum.get("splash") or spectrum.get("splash_id")
                if splash:
                    self._add_identifier("splash", str(splash), record, {"field": "spectra", "source": spectrum.get("source")})
            for name in record.all_names:
                norm_name = _normalize_name(name)
                self._by_name.setdefault(norm_name, []).append(record)
                self._name_display.setdefault(norm_name, name)

    def _add_identifier(
        self, namespace: str, identifier: Any, record: ChemicalRecord, provenance: Optional[Dict[str, Any]] = None
    ) -> None:
        value = _normalize_identifier(namespace, str(identifier))
        self._by_identifier.setdefault((namespace, value), []).append((record, provenance or {}))

    def _find_candidates(self, detected: QueryType, fuzzy: bool = False) -> List[_Candidate]:
        if not detected.valid:
            return []
        namespace = detected.namespace
        value = _normalize_identifier(namespace, detected.value)
        candidates: List[_Candidate] = []
        if namespace in {"pubchem_cid", "pubchem_sid", "hmdb", "chebi", "kegg", "lipidmaps", "drugbank", "comptox", "cas", "splash"}:
            for record, provenance in self._by_identifier.get((namespace, value), []):
                candidates.append(_Candidate(record, "exact_identifier", 0.96, detected.value, namespace, [provenance]))
        elif namespace in {"inchi", "inchikey", "smiles"}:
            for record in self._by_structure.get((namespace, value), []):
                candidates.append(_Candidate(record, "exact_structure", 0.97, detected.value, namespace))
        elif namespace == "inchikey_block1":
            for record in self._by_structure.get(("inchikey_block1", value), []):
                candidates.append(_Candidate(record, "first_block_inchikey", 0.58, detected.value, namespace))
        elif namespace == "formula":
            for record in self._by_structure.get(("formula", value), []):
                candidates.append(_Candidate(record, "formula_only", 0.42, detected.value, namespace))
        elif namespace == "name":
            name_value = _normalize_name(detected.value)
            exact_records = self._by_name.get(name_value, [])
            for record in exact_records:
                preferred = _normalize_name(record.preferred_name) == name_value
                candidates.append(
                    _Candidate(
                        record,
                        "exact_name" if preferred else "exact_synonym",
                        0.78 if preferred else 0.72,
                        detected.value,
                        "name" if preferred else "synonym",
                    )
                )
            if not candidates:
                lowered = name_value
                for record in self.records:
                    for name in record.all_names:
                        norm = _normalize_name(name)
                        if lowered and (lowered in norm or norm in lowered):
                            candidates.append(_Candidate(record, "name_contains", 0.35, name, "name_contains"))
                            break
            if fuzzy and not candidates:
                for record in self.records:
                    for name in record.all_names:
                        if _cheap_similarity(name_value, _normalize_name(name)) >= 0.82:
                            candidates.append(_Candidate(record, "fuzzy_name", 0.28, name, "fuzzy_name"))
                            break
        return _dedupe_candidates(candidates)

    def _score_candidate(
        self, candidate: _Candidate, detected: QueryType, ambiguous: bool = False
    ) -> Tuple[float, Dict[str, Any]]:
        record = candidate.record
        source_agreement = max(0, len([ns for ns, values in record.xrefs.items() if values]) - 1) * 0.015
        evidence_boost = 0.0
        if record.evidence.get("literature_count"):
            evidence_boost += 0.015
        if record.evidence.get("patent_count"):
            evidence_boost += 0.01
        if record.spectra:
            evidence_boost += 0.01
        if self.freshness:
            evidence_boost += 0.01
        ambiguity_penalty = 0.08 if ambiguous else 0.0
        score = max(0.0, min(1.0, candidate.base_score + source_agreement + evidence_boost - ambiguity_penalty))
        components = {
            "base": round(candidate.base_score, 3),
            "match_level": candidate.match_level,
            "source_agreement_boost": round(source_agreement, 3),
            "evidence_boost": round(evidence_boost, 3),
            "ambiguity_penalty": round(ambiguity_penalty, 3),
            "detected_query_type": detected.namespace,
        }
        return round(score, 3), components

    def _discover_spans(self, text: str) -> List[Tuple[int, int, str]]:
        spans: List[Tuple[int, int, str]] = []
        for match in _TOKEN_RE.finditer(text):
            spans.append((match.start(), match.end(), match.group(0)))
        for norm_name, display in sorted(self._name_display.items(), key=lambda item: len(item[1]), reverse=True):
            if len(norm_name) < 3:
                continue
            pattern = re.compile(r"(?<![\w-])" + re.escape(display) + r"(?![\w-])", re.IGNORECASE)
            for match in pattern.finditer(text):
                spans.append((match.start(), match.end(), match.group(0)))
        return _dedupe_spans(spans)


def _record_from_row(row: Mapping[str, Any]) -> ChemicalRecord:
    compound_id = str(row.get("id") or row.get("compound_id") or row.get("cid") or row.get("inchikey"))
    preferred_name = str(row.get("preferred_name") or row.get("name") or row.get("title") or compound_id)
    xrefs = _normalize_xrefs(row.get("xrefs") or {})
    if row.get("cid"):
        _append_unique(xrefs.setdefault("pubchem_cid", []), str(row["cid"]))
    if row.get("sid"):
        _append_unique(xrefs.setdefault("pubchem_sid", []), str(row["sid"]))
    for namespace in ["hmdb", "chebi", "kegg", "lipidmaps", "drugbank", "comptox", "cas"]:
        if row.get(namespace):
            values = row[namespace] if isinstance(row[namespace], list) else [row[namespace]]
            for value in values:
                _append_unique(xrefs.setdefault(namespace, []), str(value))
    synonyms = row.get("synonyms") or row.get("names") or []
    if isinstance(synonyms, str):
        synonyms = [synonyms]
    return ChemicalRecord(
        compound_id=compound_id,
        preferred_name=preferred_name,
        synonyms=[str(v) for v in synonyms if v and str(v) != preferred_name],
        xrefs=xrefs,
        formula=str(row["formula"]) if row.get("formula") else None,
        exact_mass=_optional_float(row.get("exact_mass")),
        monoisotopic_mass=_optional_float(row.get("monoisotopic_mass") or row.get("molecular_weight")),
        inchi=str(row["inchi"]) if row.get("inchi") else None,
        inchikey=str(row["inchikey"]).upper() if row.get("inchikey") else None,
        smiles=str(row["smiles"]) if row.get("smiles") else None,
        molfile=str(row["molfile"]) if row.get("molfile") else None,
        sdf=str(row["sdf"]) if row.get("sdf") else None,
        spectra=list(row.get("spectra") or []),
        evidence=dict(row.get("evidence") or {}),
        provenance=list(row.get("provenance") or []),
    )


def _record_for_related_row(records_by_id: Mapping[str, ChemicalRecord], row: Mapping[str, Any]) -> Optional[ChemicalRecord]:
    compound_id = row.get("compound_id") or row.get("id")
    if compound_id and str(compound_id) in records_by_id:
        return records_by_id[str(compound_id)]
    return None


def _normalize_xrefs(raw: Any) -> Dict[str, List[str]]:
    normalized: Dict[str, List[str]] = {}
    if isinstance(raw, Mapping):
        for namespace, values in raw.items():
            normalized_namespace = _normalize_namespace(str(namespace))
            if not normalized_namespace:
                continue
            value_list = values if isinstance(values, list) else [values]
            normalized[normalized_namespace] = [str(v) for v in value_list if v not in (None, "")]
    return normalized


def _record_outputs(record: ChemicalRecord, requested_outputs: Sequence[str], warnings: List[str]) -> Dict[str, Any]:
    all_requested = requested_outputs == ["all"]
    fields = _all_output_fields(record) if all_requested else list(requested_outputs)
    outputs: Dict[str, Any] = {}
    for field_name in fields:
        normalized = _OUTPUT_ALIASES.get(field_name, field_name)
        if normalized in _LOCAL_ONLY_PLACEHOLDERS:
            outputs[normalized] = None
            warnings.append(_LOCAL_ONLY_PLACEHOLDERS[normalized])
        elif normalized == "names":
            outputs["names"] = record.all_names
        elif normalized == "synonyms":
            outputs["synonyms"] = record.synonyms
        elif normalized in {"inchi", "inchikey", "smiles", "formula", "exact_mass", "monoisotopic_mass", "molfile", "sdf"}:
            outputs[normalized] = getattr(record, normalized)
            if outputs[normalized] in (None, ""):
                warnings.append(f"{normalized} not available locally")
        elif normalized == "xrefs":
            outputs["xrefs"] = record.xrefs
        elif normalized in record.xrefs:
            outputs[normalized] = record.xrefs.get(normalized, [])
        elif normalized == "splash":
            outputs["splash"] = [s.get("splash") or s.get("splash_id") for s in record.spectra if s.get("splash") or s.get("splash_id")]
        elif normalized == "spectra":
            outputs["spectra"] = record.spectra
        elif normalized == "evidence":
            outputs["evidence"] = record.evidence
        elif normalized == "provenance":
            outputs["provenance"] = record.provenance
        elif normalized == "freshness":
            # Freshness is included under knowledge; keep output field explicit.
            outputs["freshness"] = None
            warnings.append("freshness is returned in match knowledge for this resolver instance")
        else:
            outputs[normalized] = None
            warnings.append(f"{normalized} not available locally")
    return outputs


def _all_output_fields(record: ChemicalRecord) -> List[str]:
    fields = [
        "names",
        "synonyms",
        "inchi",
        "inchikey",
        "smiles",
        "formula",
        "exact_mass",
        "monoisotopic_mass",
        "molfile",
        "sdf",
        "xrefs",
        "splash",
    ]
    for namespace in sorted(record.xrefs):
        if namespace not in fields:
            fields.append(namespace)
    return fields


def _record_knowledge(record: ChemicalRecord, freshness: Dict[str, Any]) -> Dict[str, Any]:
    knowledge = {
        "identifiers": {
            "compound_id": record.compound_id,
            "preferred_name": record.preferred_name,
            "synonyms": record.synonyms,
            "xrefs": record.xrefs,
        },
        "structure": {
            "formula": record.formula,
            "exact_mass": record.exact_mass,
            "monoisotopic_mass": record.monoisotopic_mass,
            "inchi": record.inchi,
            "inchikey": record.inchikey,
            "smiles": record.smiles,
            "molfile": record.molfile,
            "sdf": record.sdf,
        },
        "spectra": record.spectra,
        "evidence": record.evidence,
        "database_presence": sorted(record.xrefs),
        "freshness": freshness,
        "provenance": record.provenance,
    }
    if isinstance(record.evidence.get("metabolomics"), dict):
        knowledge["metabolomics"] = record.evidence["metabolomics"]
    return knowledge


def _read_rows_if_exists(path: Path) -> List[Dict[str, Any]]:
    if path.exists():
        if path.suffix == ".parquet":
            return _read_parquet(path)
        return _read_jsonl(path)
    if path.suffix == ".jsonl":
        parquet_path = path.with_suffix(".parquet")
        if parquet_path.exists():
            return _read_parquet(parquet_path)
    return []


def _read_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                rows.append(json.loads(stripped))
            except json.JSONDecodeError as exc:
                raise ValueError(f"invalid JSONL in {path}:{line_number}: {exc}") from exc
    return rows


def _read_parquet(path: Path) -> List[Dict[str, Any]]:
    try:
        import pyarrow.parquet as parquet  # type: ignore
    except ImportError as exc:  # pragma: no cover - exercised only without optional parquet files
        raise ValueError(f"reading {path} requires optional pyarrow parquet support") from exc
    return [dict(row) for row in parquet.read_table(path).to_pylist()]


def _read_json_if_exists(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return data if isinstance(data, dict) else {"value": data}


def _parse_outputs(to: Any) -> List[str]:
    if to in (None, "", "all"):
        return ["all"]
    if isinstance(to, str):
        raw_fields = [part.strip() for part in to.split(",")]
    else:
        raw_fields = [str(part).strip() for part in to]
    fields = []
    for field_name in raw_fields:
        if not field_name:
            continue
        lowered = field_name.lower()
        fields.append(_OUTPUT_ALIASES.get(lowered, lowered))
    return _dedupe_preserve_order(fields) or ["all"]


def _normalize_namespace(namespace: str) -> str:
    lowered = str(namespace or "").strip().lower().replace("-", "_")
    return _IDENTIFIER_PREFIXES.get(lowered, _OUTPUT_ALIASES.get(lowered, lowered))


def _strip_known_prefix(value: str, namespace: str) -> str:
    match = _PREFIX_RE.match(value.strip())
    if match and _normalize_namespace(match.group(1)) == namespace:
        return match.group(2).strip()
    return value.strip()


def _validate_for_namespace(value: str, namespace: str) -> bool:
    stripped = _strip_known_prefix(value, namespace)
    if namespace == "inchi":
        return stripped.startswith("InChI=") or value.startswith("InChI=")
    if namespace == "inchikey":
        return bool(_INCHIKEY_RE.match(stripped))
    return True


def _normalize_identifier(namespace: str, value: Any) -> str:
    text = str(value or "").strip()
    normalized_namespace = _normalize_namespace(namespace)
    if normalized_namespace in {"hmdb", "kegg", "lipidmaps", "drugbank", "comptox", "inchikey", "inchikey_block1"}:
        return text.upper()
    if normalized_namespace == "chebi":
        upper = text.upper()
        return upper if upper.startswith("CHEBI:") else f"CHEBI:{upper}"
    if normalized_namespace == "formula":
        return _normalize_formula(text)
    if normalized_namespace in {"name", "synonym"}:
        return _normalize_name(text)
    return text


def _normalize_formula(formula: str) -> str:
    return re.sub(r"\s+", "", formula)


def _normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", str(name).strip().casefold())


def _looks_like_smiles(value: str) -> bool:
    if " " in value:
        return False
    if _SMILES_HINT_RE.search(value):
        return True
    # Simple organic SMILES such as CCO should not be mistaken for names.
    return bool(re.match(r"^[BCNOFPSIclbr0-9]+$", value)) and any(ch in value for ch in "CONSPFB")


def _optional_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _append_unique(items: List[str], value: str) -> None:
    if value not in items:
        items.append(value)


def _dedupe_preserve_order(items: Iterable[str]) -> List[str]:
    seen = set()
    out = []
    for item in items:
        if item not in seen:
            out.append(item)
            seen.add(item)
    return out


def _dedupe_candidates(candidates: Iterable[_Candidate]) -> List[_Candidate]:
    seen = set()
    out: List[_Candidate] = []
    for candidate in candidates:
        key = (candidate.record.compound_id, candidate.match_level, candidate.matched_namespace)
        if key not in seen:
            out.append(candidate)
            seen.add(key)
    return out


def _dedupe_spans(spans: Iterable[Tuple[int, int, str]]) -> List[Tuple[int, int, str]]:
    sorted_spans = sorted(spans, key=lambda item: (-(item[1] - item[0]), item[0]))
    accepted: List[Tuple[int, int, str]] = []
    occupied: List[Tuple[int, int]] = []
    for start, end, value in sorted_spans:
        if any(start < used_end and end > used_start for used_start, used_end in occupied):
            continue
        accepted.append((start, end, value))
        occupied.append((start, end))
    return sorted(accepted, key=lambda item: item[0])


def _cheap_similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    a_tokens = set(a)
    b_tokens = set(b)
    return len(a_tokens & b_tokens) / float(len(a_tokens | b_tokens) or 1)
