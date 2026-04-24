"""Metabolomics repository harvesting and local biological query indexing."""
from __future__ import annotations

import hashlib
import json
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

PARSER_VERSION = "metabolomics-v1"


@dataclass(frozen=True)
class SourceSpec:
    key: str
    name: str
    base_url: str
    license_terms_note: str
    record_type: str = "study"


SOURCE_REGISTRY: Dict[str, SourceSpec] = {
    "mw": SourceSpec("mw", "Metabolomics Workbench", "https://www.metabolomicsworkbench.org/rest", "Metabolomics Workbench/NMDR public REST data; retain source accession and repository terms."),
    "metabolights": SourceSpec("metabolights", "MetaboLights", "https://www.ebi.ac.uk/metabolights/ws/studies", "MetaboLights public study metadata/files; retain EBI accession and repository terms."),
    "gnps": SourceSpec("gnps", "GNPS/MassIVE", "https://gnps.ucsd.edu/ProteoSAFe", "GNPS/MassIVE public dataset metadata; retain dataset accession and GNPS/MassIVE terms."),
    "metabolomexchange": SourceSpec("metabolomexchange", "MetabolomeXchange", "https://www.metabolomexchange.org/api/studies", "MetabolomeXchange discovery metadata; use source repositories as authority for downloaded records.", "discovery_record"),
    "hub": SourceSpec("hub", "MetabolomicsHub", "https://www.metabolomicshub.org/api/studies", "MetabolomicsHub discovery metadata; use source repositories as authority for downloaded records.", "discovery_record"),
    "pubmed": SourceSpec("pubmed", "PubMed", "https://eutils.ncbi.nlm.nih.gov/entrez/eutils", "NCBI E-utilities metadata; respect NCBI rate limits and citation policies.", "publication"),
}


class HttpJsonTransport:
    def get_json(self, url: str) -> Any:
        raw = self.get_bytes(url)
        return json.loads(raw.decode("utf-8"))

    def get_bytes(self, url: str) -> bytes:
        with urllib.request.urlopen(url) as response:  # noqa: S310
            return response.read()


class MetabolomicsMirror:
    """Download source repository objects into a governed local mirror."""

    def __init__(self, transport: Optional[Any] = None, retrieved_at: Optional[str] = None):
        self.transport = transport or HttpJsonTransport()
        self.retrieved_at = retrieved_at or _utc_now()

    def mirror(
        self,
        source: str,
        output_dir: Path,
        all_data: bool = False,
        accessions: Optional[Sequence[str]] = None,
        include_raw: bool = True,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        key = source.lower()
        if key == "all":
            summary: Dict[str, Any] = {"source": "all", "accessions": 0, "files": 0, "bytes": 0}
            for each in ["mw", "metabolights", "gnps", "metabolomexchange", "hub"]:
                child = self.mirror(each, output_dir, all_data=all_data, accessions=accessions, include_raw=include_raw, limit=limit)
                _merge_counts(summary, child)
            return summary
        if key not in SOURCE_REGISTRY:
            raise ValueError(f"unsupported metabolomics source: {source}")
        spec = SOURCE_REGISTRY[key]
        selected = list(accessions or [])
        if all_data:
            selected = self.discover_accessions(spec)
        if limit is not None:
            selected = selected[:limit]
        if not selected:
            raise ValueError("mirror requires --all or at least one --accession")
        mirror_dir = Path(output_dir) / "metabolomics" / "mirror"
        manifest_rows = []
        total_bytes = 0
        for accession in selected:
            for item in self._mirror_items(spec, accession, include_raw=include_raw):
                payload = self._download(item["url"])
                local_path = self._write_mirror_file(mirror_dir, spec.key, accession, item, payload)
                total_bytes += len(payload)
                manifest_rows.append(
                    {
                        "source_name": spec.name,
                        "source_accession": accession,
                        "source_url": item["url"],
                        "source_record_type": item["record_type"],
                        "local_path": str(local_path.relative_to(Path(output_dir))),
                        "retrieved_at": self.retrieved_at,
                        "content_hash": _content_hash_bytes(payload),
                        "size_bytes": len(payload),
                        "parser_version": PARSER_VERSION,
                        "license_terms_note": spec.license_terms_note,
                    }
                )
        _append_jsonl(mirror_dir / "mirror_manifest.jsonl", manifest_rows)
        return {"source": key, "accessions": len(selected), "files": len(manifest_rows), "bytes": total_bytes}

    def discover_accessions(self, spec: SourceSpec) -> List[str]:
        url = _accession_list_url(spec)
        payload = self.transport.get_json(url)
        return _extract_accessions(payload)

    def _mirror_items(self, spec: SourceSpec, accession: str, include_raw: bool) -> List[Dict[str, str]]:
        if spec.key == "mw":
            items = [
                {"record_type": "summary", "url": f"{spec.base_url}/study/study_id/{accession}/summary/json", "filename": "summary.json"},
                {"record_type": "factors", "url": f"{spec.base_url}/study/study_id/{accession}/factors/json", "filename": "factors.json"},
                {"record_type": "datatable", "url": f"{spec.base_url}/study/study_id/{accession}/datatable/json", "filename": "datatable.json"},
                {"record_type": "mwtab", "url": f"{spec.base_url}/study/study_id/{accession}/mwtab/txt", "filename": "mwtab.txt"},
            ]
            if include_raw:
                summary = _unwrap(self.transport.get_json(items[0]["url"]))
                raw_urls = _raw_urls_from_payload(summary)
                if not raw_urls:
                    raw_urls = self._raw_urls_from_accession_listing(spec, accession)
                for index, url in enumerate(raw_urls):
                    items.append({"record_type": "raw_file", "url": url, "filename": f"raw_{index}_{Path(urllib.parse.urlparse(url).path).name or 'download'}"})
            return items
        if spec.key == "metabolights":
            items = [{"record_type": "study_metadata", "url": f"{spec.base_url}/{accession}", "filename": "study.json"}]
            if include_raw:
                items.append({"record_type": "study_archive", "url": f"https://ftp.ebi.ac.uk/pub/databases/metabolights/studies/public/{accession}/{accession}.zip", "filename": f"{accession}.zip"})
            return items
        return [{"record_type": spec.record_type, "url": _generic_study_url(spec, accession), "filename": "record.json"}]

    def _raw_urls_from_accession_listing(self, spec: SourceSpec, accession: str) -> List[str]:
        try:
            listing = self.transport.get_json(_accession_list_url(spec))
        except Exception:
            return []
        for row in _as_list(listing):
            row_accessions = set(_extract_accessions(row))
            if accession in row_accessions:
                return _raw_urls_from_payload(row)
        return []

    def _download(self, url: str) -> bytes:
        if hasattr(self.transport, "get_bytes"):
            return self.transport.get_bytes(url)
        value = self.transport.get_json(url)
        return json.dumps(value, sort_keys=True, default=str).encode("utf-8")

    def _write_mirror_file(self, mirror_dir: Path, source: str, accession: str, item: Mapping[str, str], payload: bytes) -> Path:
        target_dir = mirror_dir / "files" / source / _safe_path_part(accession)
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / _safe_path_part(item["filename"])
        tmp = target.with_suffix(target.suffix + ".part")
        tmp.write_bytes(payload)
        tmp.replace(target)
        return target


class MetabolomicsHarvester:
    def __init__(self, transport: Optional[Any] = None, retrieved_at: Optional[str] = None):
        self.transport = transport or HttpJsonTransport()
        self.retrieved_at = retrieved_at or _utc_now()

    def harvest(self, source: str, output_dir: Path, accessions: Optional[Sequence[str]] = None, pmids: Optional[Sequence[str]] = None) -> Dict[str, Any]:
        key = source.lower()
        if key not in SOURCE_REGISTRY and key != "all":
            raise ValueError(f"unsupported metabolomics source: {source}")
        metabolomics_dir = Path(output_dir) / "metabolomics"
        metabolomics_dir.mkdir(parents=True, exist_ok=True)
        if key == "all":
            summary: Dict[str, Any] = {"source": "all"}
            for each in ["mw", "metabolights", "gnps", "metabolomexchange", "hub"]:
                if accessions:
                    _merge_counts(summary, self.harvest(each, output_dir, accessions=accessions))
            if pmids:
                _merge_counts(summary, self.harvest("pubmed", output_dir, pmids=pmids))
            return summary
        spec = SOURCE_REGISTRY[key]
        if key == "mw":
            return self._harvest_mw(spec, metabolomics_dir, accessions or [])
        if key == "pubmed":
            return self._harvest_pubmed(spec, metabolomics_dir, pmids or accessions or [])
        return self._harvest_generic_studies(spec, metabolomics_dir, accessions or [])

    def _harvest_mw(self, spec: SourceSpec, output_dir: Path, accessions: Sequence[str]) -> Dict[str, Any]:
        counts = _empty_counts(spec.key)
        for accession in accessions:
            summary_url = f"{spec.base_url}/study/study_id/{accession}/summary/json"
            factors_url = f"{spec.base_url}/study/study_id/{accession}/factors/json"
            datatable_url = f"{spec.base_url}/study/study_id/{accession}/datatable/json"
            summary = _unwrap(self.transport.get_json(summary_url))
            factors = _as_list(self.transport.get_json(factors_url))
            datatable = _as_list(self.transport.get_json(datatable_url))
            study = _study_from_payload(summary, spec, accession, summary_url, self.retrieved_at)
            _append_jsonl(output_dir / "studies.jsonl", [study])
            _append_jsonl(output_dir / "provenance.jsonl", [_provenance_row(spec, accession, summary_url, summary, self.retrieved_at, "study")])
            counts["studies"] += 1
            sample_rows, factor_rows = _samples_and_factors_from_mw(study, factors, spec, accession, factors_url, self.retrieved_at)
            _append_jsonl(output_dir / "samples.jsonl", sample_rows)
            _append_jsonl(output_dir / "factors.jsonl", factor_rows)
            counts["samples"] += len(sample_rows)
            counts["factors"] += len(factor_rows)
            result_rows = [_result_from_payload(row, study, spec, accession, datatable_url, self.retrieved_at) for row in datatable]
            compound_links = _compound_links_from_results(result_rows)
            _append_jsonl(output_dir / "results.jsonl", result_rows)
            _append_jsonl(output_dir / "compound_links.jsonl", compound_links)
            _append_jsonl(output_dir / "provenance.jsonl", [_provenance_row(spec, accession, datatable_url, datatable, self.retrieved_at, "result_table")])
            counts["results"] += len(result_rows)
            counts["compound_links"] += len(compound_links)
        return counts

    def _harvest_pubmed(self, spec: SourceSpec, output_dir: Path, pmids: Sequence[str]) -> Dict[str, Any]:
        counts = _empty_counts(spec.key)
        for pmid in pmids:
            url = f"{spec.base_url}/esummary.fcgi?db=pubmed&id={urllib.parse.quote(str(pmid))}&retmode=json"
            payload = self.transport.get_json(url)
            publication = _publication_from_pubmed(payload, spec, str(pmid), url, self.retrieved_at)
            _append_jsonl(output_dir / "publications.jsonl", [publication])
            _append_jsonl(output_dir / "provenance.jsonl", [_provenance_row(spec, str(pmid), url, payload, self.retrieved_at, "publication")])
            counts["publications"] += 1
        return counts

    def _harvest_generic_studies(self, spec: SourceSpec, output_dir: Path, accessions: Sequence[str]) -> Dict[str, Any]:
        counts = _empty_counts(spec.key)
        for accession in accessions:
            url = _generic_study_url(spec, accession)
            payload = _unwrap(self.transport.get_json(url))
            study = _study_from_payload(payload, spec, accession, url, self.retrieved_at, record_type=spec.record_type)
            _append_jsonl(output_dir / "studies.jsonl", [study])
            _append_jsonl(output_dir / "provenance.jsonl", [_provenance_row(spec, accession, url, payload, self.retrieved_at, spec.record_type)])
            counts["studies"] += 1
        return counts

class MetabolomicsIndex:
    """DuckDB/Parquet index over normalized metabolomics JSONL records."""

    def __init__(self, lake_dir: Path):
        self.lake_dir = Path(lake_dir)
        self.metabolomics_dir = self.lake_dir / "metabolomics"
        self.db_path = self.metabolomics_dir / "index.duckdb"

    @classmethod
    def build(cls, lake_dir: Path) -> "MetabolomicsIndex":
        index = cls(lake_dir)
        index.metabolomics_dir.mkdir(parents=True, exist_ok=True)
        con = _duckdb_connect(index.db_path)
        try:
            for table in ["studies", "samples", "factors", "results", "publications", "compound_links", "provenance"]:
                rows = _read_jsonl(index.metabolomics_dir / f"{table}.jsonl")
                _create_table(con, table, rows)
                _copy_table_to_parquet(con, table, index.metabolomics_dir / f"{table}.parquet")
            _create_biological_view(con)
        finally:
            con.close()
        return index

    def query(
        self,
        compound: Optional[str] = None,
        species: Optional[str] = None,
        organ: Optional[str] = None,
        genotype: Optional[str] = None,
        disease: Optional[str] = None,
        publication: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        con = _duckdb_connect(self.db_path)
        try:
            clauses = []
            params: List[Any] = []
            if compound:
                clauses.append("(lower(metabolite_name) = lower(?) OR pubchem_cid = ? OR lower(inchikey) = lower(?))")
                params.extend([compound, compound, compound])
            for field, value in [("species", species), ("organ", organ), ("genotype", genotype), ("disease", disease)]:
                if value:
                    clauses.append(f"lower({field}) = lower(?)")
                    params.append(value)
            if publication:
                clauses.append("(pmid = ? OR lower(doi) = lower(?))")
                params.extend([publication, publication])
            sql = "SELECT * FROM biological_results"
            if clauses:
                sql += " WHERE " + " AND ".join(clauses)
            sql += " ORDER BY study_id, sample_id, metabolite_name"
            cur = con.execute(sql, params)
            return [dict(zip([desc[0] for desc in cur.description], row)) for row in cur.fetchall()]
        finally:
            con.close()


def enrich_record_with_metabolomics(record: Any, data_dir: Path) -> None:
    metabolomics_dir = Path(data_dir) / "metabolomics"
    rows = _read_jsonl(metabolomics_dir / "results.jsonl")
    if not rows:
        return
    matched = []
    record_cids = set(record.xrefs.get("pubchem_cid", []))
    record_names = {record.preferred_name.lower(), *[name.lower() for name in record.synonyms]}
    for row in rows:
        if (
            row.get("pubchem_cid") in record_cids
            or str(row.get("inchikey") or "").upper() == str(record.inchikey or "").upper()
            or str(row.get("metabolite_name") or "").lower() in record_names
        ):
            matched.append(row)
    if not matched:
        return
    studies_by_id = {row.get("study_id"): row for row in _read_jsonl(metabolomics_dir / "studies.jsonl")}
    studies = []
    for row in matched:
        study = studies_by_id.get(row.get("study_id"), {})
        studies.append(
            {
                "study_id": row.get("study_id"),
                "analysis_id": row.get("analysis_id"),
                "sample_id": row.get("sample_id"),
                "metabolite_name": row.get("metabolite_name"),
                "species": study.get("species"),
                "organ": study.get("organ"),
                "genotype": study.get("genotype"),
                "disease": study.get("disease"),
                "source_name": row.get("source_name"),
                "source_accession": row.get("source_accession"),
            }
        )
    record.evidence["metabolomics"] = {"result_count": len(matched), "studies": _dedupe_dicts(studies)}


def _generic_study_url(spec: SourceSpec, accession: str) -> str:
    if spec.key == "gnps":
        return f"{spec.base_url}/QueryDataset?task={urllib.parse.quote(str(accession))}"
    return f"{spec.base_url}/{urllib.parse.quote(str(accession))}"


def _study_from_payload(payload: Mapping[str, Any], spec: SourceSpec, accession: str, url: str, retrieved_at: str, record_type: str = "study") -> Dict[str, Any]:
    pmids = _split_ids(payload.get("pmids") or payload.get("pmid") or payload.get("PMID"))
    dois = _split_ids(payload.get("dois") or payload.get("doi") or payload.get("DOI"))
    return _with_governance(
        {
            "study_id": str(payload.get("study_id") or payload.get("studyId") or payload.get("dataset_id") or accession),
            "title": payload.get("title") or payload.get("study_title") or payload.get("name"),
            "description": payload.get("description") or payload.get("summary"),
            "organism": payload.get("organism"),
            "species": payload.get("species") or payload.get("organism"),
            "organ": payload.get("organ") or payload.get("tissue") or payload.get("sample_source"),
            "genotype": payload.get("genotype") or payload.get("strain"),
            "disease": payload.get("disease") or payload.get("condition"),
            "repository": payload.get("repository"),
            "repository_accession": payload.get("repository_accession"),
            "pmids": pmids,
            "dois": dois,
            "source_record_type": record_type,
        },
        spec,
        accession,
        url,
        payload,
        retrieved_at,
    )


def _samples_and_factors_from_mw(study: Mapping[str, Any], factors: Sequence[Mapping[str, Any]], spec: SourceSpec, accession: str, url: str, retrieved_at: str) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    by_sample: Dict[str, Dict[str, Any]] = {}
    factor_rows = []
    for index, factor in enumerate(factors):
        sample_id = str(factor.get("sample_id") or factor.get("sample") or f"{study['study_id']}:sample")
        name = str(factor.get("factor") or factor.get("name") or factor.get("field") or "factor")
        value = factor.get("value")
        by_sample.setdefault(
            sample_id,
            {"sample_id": sample_id, "study_id": study["study_id"], "species": study.get("species"), "organ": study.get("organ"), "genotype": study.get("genotype"), "disease": study.get("disease"), "factors": {}, "source_record_type": "sample"},
        )["factors"][name] = value
        factor_rows.append(
            _with_governance(
                {"factor_id": f"{study['study_id']}:{sample_id}:{index}", "study_id": study["study_id"], "sample_id": sample_id, "name": name, "value": value, "unit": factor.get("unit"), "source_record_type": "factor"},
                spec,
                accession,
                url,
                factor,
                retrieved_at,
            )
        )
    if not by_sample:
        sample_id = f"{study['study_id']}:sample"
        by_sample[sample_id] = {"sample_id": sample_id, "study_id": study["study_id"], "species": study.get("species"), "organ": study.get("organ"), "genotype": study.get("genotype"), "disease": study.get("disease"), "factors": {}, "source_record_type": "sample"}
    return [_with_governance(row, spec, accession, url, factors, retrieved_at) for row in by_sample.values()], factor_rows

def _result_from_payload(row: Mapping[str, Any], study: Mapping[str, Any], spec: SourceSpec, accession: str, url: str, retrieved_at: str) -> Dict[str, Any]:
    metabolite_name = row.get("metabolite_name") or row.get("metabolite") or row.get("name") or row.get("compound")
    result_id = row.get("result_id") or f"{study['study_id']}:{row.get('analysis_id') or ''}:{row.get('sample_id') or ''}:{metabolite_name or ''}"
    return _with_governance(
        {
            "result_id": result_id,
            "study_id": study["study_id"],
            "analysis_id": row.get("analysis_id") or row.get("analysis"),
            "sample_id": row.get("sample_id") or row.get("sample"),
            "metabolite_name": metabolite_name,
            "pubchem_cid": _string_or_none(row.get("pubchem_cid") or row.get("cid")),
            "inchikey": row.get("inchikey") or row.get("inchi_key"),
            "hmdb": row.get("hmdb"),
            "chebi": row.get("chebi"),
            "kegg": row.get("kegg"),
            "refmet": row.get("refmet"),
            "abundance": _float_or_none(row.get("abundance") or row.get("value") or row.get("intensity")),
            "unit": row.get("unit"),
            "source_record_type": "result_measurement",
        },
        spec,
        accession,
        url,
        row,
        retrieved_at,
    )


def _publication_from_pubmed(payload: Mapping[str, Any], spec: SourceSpec, pmid: str, url: str, retrieved_at: str) -> Dict[str, Any]:
    result = payload.get("result", {}) if isinstance(payload, Mapping) else {}
    article = result.get(pmid) or result.get(str(pmid)) or {}
    doi = None
    for article_id in article.get("articleids", []) or []:
        if str(article_id.get("idtype", "")).lower() == "doi":
            doi = article_id.get("value")
            break
    return _with_governance(
        {"pmid": str(article.get("uid") or pmid), "doi": doi, "title": article.get("title"), "journal": article.get("fulljournalname") or article.get("source"), "publication_date": article.get("pubdate"), "source_record_type": "publication"},
        spec,
        pmid,
        url,
        payload,
        retrieved_at,
    )


def _compound_links_from_results(rows: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    links = []
    for row in rows:
        for namespace in ["pubchem_cid", "inchikey", "hmdb", "chebi", "kegg", "refmet"]:
            value = row.get(namespace)
            if value:
                links.append(
                    {
                        "study_id": row.get("study_id"),
                        "result_id": row.get("result_id"),
                        "observed_label": row.get("metabolite_name"),
                        "namespace": namespace,
                        "identifier": value,
                        "link_confidence": 0.95 if namespace in {"pubchem_cid", "inchikey"} else 0.85,
                        "source_name": row.get("source_name"),
                        "source_accession": row.get("source_accession"),
                        "source_url": row.get("source_url"),
                        "source_record_type": "compound_link",
                        "retrieved_at": row.get("retrieved_at"),
                        "content_hash": row.get("content_hash"),
                        "parser_version": row.get("parser_version"),
                        "license_terms_note": row.get("license_terms_note"),
                    }
                )
    return links


def _with_governance(row: Dict[str, Any], spec: SourceSpec, accession: str, url: str, payload: Any, retrieved_at: str) -> Dict[str, Any]:
    governed = dict(row)
    governed.update(
        {
            "source_name": spec.name,
            "source_accession": str(accession),
            "source_url": url,
            "source_record_type": governed.get("source_record_type") or spec.record_type,
            "retrieved_at": retrieved_at,
            "content_hash": _content_hash(payload),
            "parser_version": PARSER_VERSION,
            "license_terms_note": spec.license_terms_note,
        }
    )
    return governed


def _provenance_row(spec: SourceSpec, accession: str, url: str, payload: Any, retrieved_at: str, record_type: str) -> Dict[str, Any]:
    return _with_governance({"provenance_id": f"{spec.key}:{accession}:{record_type}:{_content_hash(payload)[7:19]}", "record_count": len(payload) if isinstance(payload, list) else 1, "source_record_type": record_type}, spec, accession, url, payload, retrieved_at)


def _duckdb_connect(path: Path):
    try:
        import duckdb  # type: ignore
    except ImportError as exc:
        raise RuntimeError("MetabolomicsIndex requires the 'duckdb' package") from exc
    return duckdb.connect(str(path))


def _create_table(con: Any, table: str, rows: Sequence[Mapping[str, Any]]) -> None:
    con.execute(f"DROP TABLE IF EXISTS {table}")
    if not rows:
        columns = _default_columns(table)
        defs = ", ".join(f"{col} {_default_type(col)}" for col in columns)
        con.execute(f"CREATE TABLE {table} ({defs})")
        return
    columns = _columns(rows)
    defs = ", ".join(f"{col} {_duckdb_type(rows, col)}" for col in columns)
    con.execute(f"CREATE TABLE {table} ({defs})")
    placeholders = ", ".join(["?"] * len(columns))
    values = [[_sql_value(row.get(col)) for col in columns] for row in rows]
    con.executemany(f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})", values)


def _copy_table_to_parquet(con: Any, table: str, path: Path) -> None:
    safe_path = str(path).replace("'", "''")
    con.execute(f"COPY {table} TO '{safe_path}' (FORMAT PARQUET)")


def _create_biological_view(con: Any) -> None:
    con.execute("DROP VIEW IF EXISTS biological_results")
    con.execute(
        """
        CREATE VIEW biological_results AS
        SELECT r.study_id, r.analysis_id, r.sample_id, r.metabolite_name, r.pubchem_cid, r.inchikey,
               r.abundance, r.unit, COALESCE(s.species, st.species) AS species,
               COALESCE(s.organ, st.organ) AS organ, COALESCE(s.genotype, st.genotype) AS genotype,
               COALESCE(s.disease, st.disease) AS disease, st.title AS study_title,
               st.source_name AS source_name, st.source_accession AS source_accession, st.source_url AS source_url,
               list_extract(st.pmids, 1) AS pmid, p.doi AS doi, p.title AS publication_title, p.journal AS journal,
               r.retrieved_at AS retrieved_at, r.content_hash AS content_hash, r.parser_version AS parser_version,
               r.license_terms_note AS license_terms_note
        FROM results r
        LEFT JOIN studies st ON r.study_id = st.study_id
        LEFT JOIN samples s ON r.study_id = s.study_id AND r.sample_id = s.sample_id
        LEFT JOIN publications p ON list_contains(st.pmids, p.pmid)
        """
    )


def _columns(rows: Sequence[Mapping[str, Any]]) -> List[str]:
    cols: List[str] = []
    for row in rows:
        for key in row:
            if key not in cols:
                cols.append(key)
    return cols


def _default_columns(table: str) -> List[str]:
    defaults = {
        "studies": ["study_id", "title", "species", "organ", "genotype", "disease", "pmids", "source_name", "source_accession", "source_url", "retrieved_at", "content_hash", "parser_version", "license_terms_note"],
        "samples": ["sample_id", "study_id", "species", "organ", "genotype", "disease", "factors", "source_name", "source_accession", "source_url", "retrieved_at", "content_hash", "parser_version", "license_terms_note"],
        "factors": ["factor_id", "study_id", "sample_id", "name", "value", "unit", "source_name", "source_accession", "source_url", "retrieved_at", "content_hash", "parser_version", "license_terms_note"],
        "results": ["result_id", "study_id", "analysis_id", "sample_id", "metabolite_name", "pubchem_cid", "inchikey", "abundance", "unit", "source_name", "source_accession", "source_url", "retrieved_at", "content_hash", "parser_version", "license_terms_note"],
        "publications": ["pmid", "doi", "title", "journal", "publication_date", "source_name", "source_accession", "source_url", "retrieved_at", "content_hash", "parser_version", "license_terms_note"],
        "compound_links": ["study_id", "result_id", "observed_label", "namespace", "identifier", "link_confidence", "source_name", "source_accession", "source_url", "retrieved_at", "content_hash", "parser_version", "license_terms_note"],
        "provenance": ["provenance_id", "source_name", "source_accession", "source_url", "source_record_type", "retrieved_at", "content_hash", "parser_version", "license_terms_note"],
    }
    return defaults.get(table, ["id"])


def _default_type(column: str) -> str:
    if column == "pmids":
        return "VARCHAR[]"
    if column in {"abundance", "link_confidence"}:
        return "DOUBLE"
    return "VARCHAR"


def _duckdb_type(rows: Sequence[Mapping[str, Any]], col: str) -> str:
    values = [row.get(col) for row in rows if row.get(col) is not None]
    if values and all(isinstance(value, bool) for value in values):
        return "BOOLEAN"
    if values and all(isinstance(value, int) and not isinstance(value, bool) for value in values):
        return "BIGINT"
    if values and all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in values):
        return "DOUBLE"
    if values and all(isinstance(value, list) and all(isinstance(item, str) for item in value) for value in values):
        return "VARCHAR[]"
    return "VARCHAR"


def _sql_value(value: Any) -> Any:
    if isinstance(value, dict):
        return json.dumps(value, sort_keys=True)
    if isinstance(value, list):
        return value if all(isinstance(item, str) for item in value) else json.dumps(value, sort_keys=True)
    return value

def _read_jsonl(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _append_jsonl(path: Path, rows: Iterable[Mapping[str, Any]]) -> None:
    rows = list(rows)
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def _empty_counts(source: str) -> Dict[str, Any]:
    return {"source": source, "studies": 0, "samples": 0, "factors": 0, "results": 0, "compound_links": 0, "publications": 0}


def _merge_counts(base: Dict[str, Any], child: Mapping[str, Any]) -> None:
    for key, value in child.items():
        if isinstance(value, int):
            base[key] = base.get(key, 0) + value


def _unwrap(payload: Any) -> Mapping[str, Any]:
    if isinstance(payload, list):
        return payload[0] if payload else {}
    if isinstance(payload, Mapping):
        for key in ["study", "data", "result"]:
            value = payload.get(key)
            if isinstance(value, Mapping):
                return value
        return payload
    return {}


def _as_list(payload: Any) -> List[Mapping[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, Mapping)]
    if isinstance(payload, Mapping):
        for key in ["rows", "data", "results", "factors"]:
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, Mapping)]
        return [payload]
    return []


def _split_ids(value: Any) -> List[str]:
    if value in (None, ""):
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item not in (None, "")]
    return [part.strip() for part in str(value).replace(";", ",").split(",") if part.strip()]


def _float_or_none(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _string_or_none(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    return str(value)


def _content_hash(payload: Any) -> str:
    canonical = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _dedupe_dicts(rows: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out = []
    for row in rows:
        key = json.dumps(row, sort_keys=True, default=str)
        if key not in seen:
            out.append(dict(row))
            seen.add(key)
    return out


def _accession_list_url(spec: SourceSpec) -> str:
    if spec.key == "mw":
        return f"{spec.base_url}/study/study_id/all/summary/json"
    if spec.key == "metabolights":
        return spec.base_url
    if spec.key == "gnps":
        return f"{spec.base_url}/datasets_json.jsp"
    return spec.base_url


def _extract_accessions(payload: Any) -> List[str]:
    accessions: List[str] = []
    if isinstance(payload, Mapping):
        for key in ["studies", "datasets", "results", "data"]:
            if isinstance(payload.get(key), list):
                accessions.extend(_extract_accessions(payload[key]))
        for key in ["study_id", "studyId", "accession", "dataset_id", "task", "id"]:
            if payload.get(key):
                accessions.append(str(payload[key]))
    elif isinstance(payload, list):
        for item in payload:
            accessions.extend(_extract_accessions(item))
    elif isinstance(payload, str):
        for line in payload.splitlines():
            stripped = line.strip()
            if stripped:
                accessions.append(stripped.split()[0])
    return _dedupe_strings(accessions)


def _raw_urls_from_payload(payload: Mapping[str, Any]) -> List[str]:
    urls: List[str] = []
    for key in ["download_url", "raw_url", "raw_file", "raw_files", "data_files", "files"]:
        value = payload.get(key)
        if isinstance(value, str) and value.startswith(("http://", "https://", "ftp://")):
            urls.append(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, str) and item.startswith(("http://", "https://", "ftp://")):
                    urls.append(item)
                elif isinstance(item, Mapping):
                    urls.extend(_raw_urls_from_payload(item))
        elif isinstance(value, Mapping):
            urls.extend(_raw_urls_from_payload(value))
    return _dedupe_strings(urls)


def _content_hash_bytes(payload: bytes) -> str:
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def _safe_path_part(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in str(value)) or "item"


def _dedupe_strings(values: Iterable[str]) -> List[str]:
    seen = set()
    out = []
    for value in values:
        if value not in seen:
            out.append(value)
            seen.add(value)
    return out
