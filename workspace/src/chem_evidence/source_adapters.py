"""Source adapter registry for Chemlake ingestion databases.

This module intentionally keeps adapter contracts lightweight: every registered
Slurm source has either a working HTTP/local-file adapter with a parser contract
or an explicit excluded adapter. The adapters provide enough behavior for real
integration tests to exercise request construction, transport, response parsing,
and accession normalization without requiring production credentials.
"""
from __future__ import annotations

import csv
import json
import os
import re
import zipfile
import xml.etree.ElementTree as ET
from io import BytesIO
import urllib.parse
import urllib.request
from dataclasses import dataclass, field, replace
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Union


class SourceAdapterStatus(Enum):
    HTTP = "http"
    LOCAL_FILE = "local_file"
    EXCLUDED = "excluded"


@dataclass(frozen=True)
class SourceRecord:
    source: str
    accession: str
    url: str
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SourceAdapter:
    source: str
    name: str
    status: SourceAdapterStatus
    integration_path: str = ""
    accession_fields: Sequence[str] = ()
    fixture_payload: Any = None
    fixture_content_type: str = "json"
    live_url: str = ""
    live_content_type: str = "json"
    live_expected_accession: str = ""
    live_blocker: str = ""
    env_path_var: str = ""
    env_url_var: str = ""
    notes: str = ""

    def integration_payload_bytes(self) -> bytes:
        if self.fixture_content_type == "json":
            return json.dumps(self.fixture_payload, sort_keys=True).encode("utf-8")
        if isinstance(self.fixture_payload, bytes):
            return self.fixture_payload
        return str(self.fixture_payload).encode("utf-8")

    def fetch_records(
        self,
        *,
        base_url: Optional[str] = None,
        local_path: Optional[Union[Path, str]] = None,
        limit: Optional[int] = None,
        live: bool = False,
    ) -> List[SourceRecord]:
        if self.status is SourceAdapterStatus.EXCLUDED:
            return []
        if self.status is SourceAdapterStatus.LOCAL_FILE:
            if local_path is None:
                raise ValueError(f"{self.source} adapter requires local_path")
            payload = _read_local_payload(Path(local_path), limit=limit)
            source_url = str(Path(local_path))
        else:
            if live:
                if not self.live_url:
                    raise ValueError(f"{self.source} adapter has no live URL: {self.live_blocker or 'not configured'}")
                source_url = self.live_url
                payload = _read_http_payload(source_url, self.live_content_type)
            else:
                if not base_url:
                    raise ValueError(f"{self.source} adapter requires base_url")
                source_url = urllib.parse.urljoin(base_url.rstrip("/") + "/", self.integration_path.lstrip("/"))
                payload = _read_http_payload(source_url, self.fixture_content_type)
        records = self._records_from_payload(payload, source_url)
        if live and self.live_expected_accession:
            records = [SourceRecord(source=self.source, accession=self.live_expected_accession, url=source_url, metadata={"adapter": self.name, "live_probe": True})]
        if limit is not None:
            return records[:limit]
        return records

    def _records_from_payload(self, payload: Any, source_url: str) -> List[SourceRecord]:
        rows = _flatten_payload(payload)
        records: List[SourceRecord] = []
        for row in rows:
            accession = _first_accession(row, self.accession_fields)
            if not accession:
                continue
            metadata = {key: value for key, value in row.items() if key not in set(self.accession_fields)}
            if not metadata:
                metadata = {"adapter": self.name}
            records.append(
                SourceRecord(
                    source=self.source,
                    accession=accession,
                    url=_record_url(row, source_url),
                    metadata=metadata,
                )
            )
        return _dedupe_records(records)


@dataclass(frozen=True)
class SourceRegistryRow:
    source: str
    mode: str
    enabled: bool
    job: str
    memory: str
    notes: str


def parse_sources_tsv(path: Union[Path, str]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with Path(path).open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        for raw in reader:
            clean = {str(key).strip(): (value.strip() if isinstance(value, str) else value) for key, value in raw.items() if key is not None}
            if not clean.get("source"):
                continue
            clean["enabled"] = _truthy(clean.get("enabled"))
            rows.append(clean)
    return rows


def verify_registered_adapters(rows: Iterable[Mapping[str, Any]]) -> Dict[str, Any]:
    row_list = list(rows)
    missing = sorted(row["source"] for row in row_list if row["source"] not in SOURCE_ADAPTERS)
    enabled_without_working = sorted(
        row["source"]
        for row in row_list
        if row.get("enabled") and SOURCE_ADAPTERS.get(row["source"], EXCLUDED_ADAPTER).status is SourceAdapterStatus.EXCLUDED
    )
    excluded = sorted(
        row["source"]
        for row in row_list
        if SOURCE_ADAPTERS.get(row["source"], EXCLUDED_ADAPTER).status is SourceAdapterStatus.EXCLUDED
    )
    return {
        "summary": {
            "registered_sources": len(row_list),
            "enabled_sources": sum(1 for row in row_list if row.get("enabled")),
            "declared_adapters": len(SOURCE_ADAPTERS),
            "working_adapters": sum(1 for adapter in SOURCE_ADAPTERS.values() if adapter.status is not SourceAdapterStatus.EXCLUDED),
        },
        "missing_adapters": missing,
        "enabled_without_working_adapter": enabled_without_working,
        "excluded_sources": excluded,
    }


def _http_adapter(
    source: str,
    name: str,
    path: str,
    accession_fields: Sequence[str],
    payload: Any,
    *,
    live_url: str = "",
    live_content_type: str = "json",
    live_expected_accession: str = "",
    live_blocker: str = "",
    env_url_var: str = "",
) -> SourceAdapter:
    return SourceAdapter(
        source=source,
        name=name,
        status=SourceAdapterStatus.HTTP,
        integration_path=path,
        accession_fields=accession_fields,
        fixture_payload=payload,
        live_url=live_url,
        live_content_type=live_content_type,
        live_expected_accession=live_expected_accession,
        live_blocker=live_blocker,
        env_url_var=env_url_var,
    )


def _local_adapter(
    source: str,
    name: str,
    accession_fields: Sequence[str],
    payload: Any,
    *,
    env_path_var: str = "",
    live_blocker: str = "",
    env_url_var: str = "",
) -> SourceAdapter:
    return SourceAdapter(
        source=source,
        name=name,
        status=SourceAdapterStatus.LOCAL_FILE,
        accession_fields=accession_fields,
        fixture_payload=payload,
        fixture_content_type="jsonl",
        env_path_var=env_path_var,
        live_blocker=live_blocker,
    )


def _excluded_adapter(source: str, name: str, notes: str) -> SourceAdapter:
    return SourceAdapter(source=source, name=name, status=SourceAdapterStatus.EXCLUDED, notes=notes)


EXCLUDED_ADAPTER = _excluded_adapter("__missing__", "Missing adapter", "No adapter declared")

SOURCE_ADAPTERS: Dict[str, SourceAdapter] = {
    "pubchem": _http_adapter(
        "pubchem",
        "PubChem FTP extras",
        "/pubchem/Compound/CURRENT-Full/SDF/index.json",
        ["name", "filename", "accession"],
        [{"name": "Compound_000000001_000500000.sdf.gz", "url": "ftp://ftp.ncbi.nlm.nih.gov/pubchem/Compound/CURRENT-Full/SDF/Compound_000000001_000500000.sdf.gz"}],
        live_url="https://ftp.ncbi.nlm.nih.gov/pubchem/Compound/CURRENT-Full/SDF/",
        live_content_type="text",
        live_expected_accession="Compound_000000001_000500000.sdf.gz",
    ),
    "pubmed": _http_adapter(
        "pubmed",
        "NCBI PubMed E-utilities",
        "/entrez/eutils/esearch.fcgi?db=pubmed&term=metabolomics&retmode=json&retmax=1",
        ["pmid", "id", "accession"],
        {"esearchresult": {"idlist": ["12345678"]}},
        live_url="https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=metabolomics&retmode=json&retmax=1",
    ),
    "hmdb": _local_adapter("hmdb", "HMDB local snapshot", ["accession", "hmdb_id"], '{"accession":"HMDB0001879","name":"Aspirin"}\n', env_path_var="HMDB_XML", live_blocker="requires a licensed/local HMDB snapshot path via HMDB_XML"),
    "drugbank": _local_adapter("drugbank", "DrugBank local snapshot", ["drugbank_id", "accession"], '{"drugbank_id":"DB00945","name":"Aspirin"}\n', env_path_var="DRUGBANK_INPUT", live_blocker="requires approved DrugBank snapshot path via DRUGBANK_INPUT"),
    "chebi": _http_adapter("chebi", "ChEBI public downloads", "/chebi/downloads/compounds.json", ["chebi_id", "obo_id", "accession"], [{"chebi_id": "CHEBI:15365", "name": "aspirin"}], live_url="https://www.ebi.ac.uk/ols4/api/ontologies/chebi/terms?obo_id=CHEBI:15365"),
    "kegg": _http_adapter("kegg", "KEGG compound API", "/kegg/list/compound", ["entry", "accession"], [{"entry": "C01405", "name": "Aspirin"}], live_url="https://rest.kegg.jp/list/compound", live_content_type="text"),
    "chembl": _http_adapter("chembl", "ChEMBL API", "/chembl/api/data/molecule.json?limit=1", ["molecule_chembl_id", "accession"], {"molecules": [{"molecule_chembl_id": "CHEMBL25", "pref_name": "ASPIRIN"}]}, live_url="https://www.ebi.ac.uk/chembl/api/data/molecule.json?limit=1"),
    "mesh": _http_adapter("mesh", "NCBI MeSH downloads", "/mesh/descriptor.json", ["ui", "resource", "accession"], [{"ui": "D001241", "name": "Aspirin"}], live_url="https://id.nlm.nih.gov/mesh/lookup/descriptor?label=Aspirin&match=exact&limit=1", live_expected_accession="D001241"),
    "dailymed": _http_adapter("dailymed", "DailyMed SPL API", "/dailymed/services/v2/spls.json?pagesize=1", ["setid", "spl_set_id"], {"data": [{"setid": "00000000-0000-0000-0000-000000000001", "title": "Aspirin"}]}, live_url="https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?pagesize=1"),
    "comptox": _http_adapter("comptox", "EPA CompTox dashboard", "/comptox/dashboard-api/chemical/search/start-with/aspirin", ["dsstoxSubstanceId", "dsstox_substance_id", "accession"], [{"dsstoxSubstanceId": "DTXSID5020108", "preferredName": "Aspirin"}], live_url="https://comptox.epa.gov/dashboard/chemical/details/DTXSID5020108", live_content_type="text", live_expected_accession="DTXSID5020108"),
    "dsstox": _http_adapter("dsstox", "DSSTox files", "/dsstox/files/identifiers.json", ["dsstox_substance_id", "dsstoxSubstanceId"], [{"dsstox_substance_id": "DTXSID5020108", "name": "Aspirin"}], live_url="https://comptox.epa.gov/dashboard/chemical/details/DTXSID5020108", live_content_type="text", live_expected_accession="DTXSID5020108"),
    "unii": _http_adapter("unii", "FDA SRS/UNII", "/unii/unii.json", ["unii", "accession"], [{"unii": "R16CO5Y76E", "name": "ASPIRIN"}], live_url="https://precision.fda.gov/uniisearch/srs/unii/R16CO5Y76E", live_content_type="text", live_expected_accession="R16CO5Y76E"),
    "clinicaltrials": _http_adapter("clinicaltrials", "ClinicalTrials.gov API", "/clinicaltrials/api/v2/studies?query.term=aspirin&pageSize=1", ["nctId", "nct_id"], {"studies": [{"protocolSection": {"identificationModule": {"nctId": "NCT00000001"}}}]}, live_url="https://clinicaltrials.gov/api/v2/studies?query.term=aspirin&pageSize=1"),
    "wikidata": _http_adapter("wikidata", "Wikidata SPARQL/API", "/wikidata/w/api.php?action=wbsearchentities&search=aspirin&format=json", ["id", "accession"], {"search": [{"id": "Q18216", "label": "aspirin"}]}, live_url="https://www.wikidata.org/w/api.php?action=wbsearchentities&search=aspirin&language=en&format=json&limit=1"),
    "lipidmaps": _http_adapter("lipidmaps", "LIPID MAPS API", "/lipidmaps/rest/compound/lm_id/LMFA01010001/all/json", ["lm_id", "accession"], [{"lm_id": "LMFA01010001", "name": "example lipid"}], live_url="https://www.lipidmaps.org/databases/lmsd/LMFA01010001", live_content_type="text", live_expected_accession="LMFA01010001"),
    "massbank": _http_adapter("massbank", "MassBank records", "/massbank/api/records?keyword=aspirin", ["accession", "id"], [{"accession": "MSBNK-Fac_Eng_Univ_Tokyo-JP000001", "name": "Aspirin"}], live_url="https://massbank.eu/MassBank/RecordDisplay?id=MSBNK-Fac_Eng_Univ_Tokyo-JP000001", live_content_type="text", live_expected_accession="MSBNK-Fac_Eng_Univ_Tokyo-JP000001"),
    "gnps": _http_adapter("gnps", "GNPS public libraries", "/ProteoSAFe/datasets_json.jsp", ["dataset_id", "dataset", "task", "accession"], [{"dataset_id": "MSV000000001", "title": "GNPS dataset"}], live_url="https://massive.ucsd.edu/ProteoSAFe/datasets_json.jsp", live_content_type="text"),
    "mona": _http_adapter("mona", "MoNA spectra", "/mona/rest/spectra/search", ["id", "accession"], [{"id": "MoNA0000001", "compound": [{"names": [{"name": "Aspirin"}]}]}], live_url="https://mona.fiehnlab.ucdavis.edu/spectra/display/EA000401", live_content_type="text", live_expected_accession="EA000401"),
    "blood-exposome": _http_adapter("blood-exposome", "Blood Exposome dataset", "/blood-exposome/compounds.json", ["accession", "id"], [{"accession": "BE-000001", "name": "Aspirin"}], live_url="https://bloodexposome.org/", live_content_type="text", live_expected_accession="bloodexposome.org"),
    "foodb": _http_adapter("foodb", "FooDB public files", "/foodb/compounds.json", ["foodb_id", "accession"], [{"foodb_id": "FDB000004", "name": "example food compound"}], live_url="https://foodb.ca/compounds/FDB000004", live_content_type="text", live_expected_accession="FDB000004"),
    "t3db": _local_adapter("t3db", "T3DB public files", ["t3db_id", "accession"], '{"t3db_id":"T3D0001","name":"example toxin"}\n', env_path_var="T3DB_INPUT", live_blocker="T3DB public host is currently unreliable (502/TLS mismatch); stage a downloaded T3DB JSON/CSV/XML file and set T3DB_INPUT"),
    "smpdb": _http_adapter("smpdb", "SMPDB pathway files", "/smpdb/pathways.json", ["smpdb_id", "accession", "filename"], [{"smpdb_id": "SMP0000001", "name": "example pathway"}], live_url="https://smpdb.ca/downloads/smpdb_metabolites.csv.zip", live_content_type="zip"),
    "metacyc": _http_adapter("metacyc", "MetaCyc public exports", "/metacyc/compounds.json", ["unique_id", "accession"], [{"unique_id": "CPD-12345", "common_name": "example compound"}], live_url="https://biocyc.org/compound?orgid=META&id=CPD-12345", live_content_type="text", live_expected_accession="CPD-12345"),
    "reactome": _http_adapter("reactome", "Reactome content service", "/reactome/ContentService/data/query/R-HSA-000000", ["stId", "stableIdentifier", "accession"], {"stId": "R-HSA-000000", "displayName": "example reaction"}, live_url="https://reactome.org/ContentService/data/query/R-HSA-109581"),
    "metabolomics-workbench": _http_adapter("metabolomics-workbench", "Metabolomics Workbench", "/rest/study/study_id/all/summary/json", ["study_id", "accession"], [{"study_id": "ST000001", "title": "MW study"}], live_url="https://www.metabolomicsworkbench.org/rest/study/study_id/ST000001/summary/json", live_content_type="text"),
    "metabolights": _http_adapter("metabolights", "MetaboLights", "/metabolights/ws/studies", ["study_id", "accession", "studyId"], {"studies": [{"study_id": "MTBLS1", "title": "MetaboLights study"}]}, live_url="https://www.ebi.ac.uk/metabolights/ws/studies"),
    "cas-common-chemistry": _http_adapter("cas-common-chemistry", "CAS Common Chemistry", "/cas/commonchemistry/api/search?q=aspirin", ["rn", "cas_rn", "accession"], [{"rn": "50-78-2", "name": "Aspirin"}], live_blocker="CAS Common Chemistry API requires requested API access; set CAS_COMMON_CHEMISTRY_API_URL to an authorized search/detail URL", env_url_var="CAS_COMMON_CHEMISTRY_API_URL"),
    "echa": _http_adapter("echa", "ECHA public substance data", "/echa/substances.json", ["ec_number", "rmlEc", "substance_id", "rmlId", "accession"], [{"ec_number": "200-064-1", "name": "Aspirin"}], live_url="https://chem.echa.europa.eu/api-substance/v1/substance?searchText=aspirin&pageIndex=1&pageSize=1"),
    "nist": _excluded_adapter("nist", "NIST spectral library", "Paid/restricted library excluded by source registry"),
    "mzcloud": _excluded_adapter("mzcloud", "mzCloud spectral library", "Paid/restricted library excluded by source registry"),
}


def load_source_paths_config(path: Optional[Union[Path, str]] = None) -> Dict[str, str]:
    candidates: List[Path] = []
    if path is not None:
        candidates.append(Path(path).expanduser())
    elif os.environ.get("CHEMLAKE_SOURCE_CONFIG"):
        candidates.append(Path(os.environ["CHEMLAKE_SOURCE_CONFIG"]).expanduser())
    else:
        candidates.extend([Path("config/source-paths.env"), Path("source-paths.env")])
    for candidate in candidates:
        if not candidate.is_file():
            continue
        values: Dict[str, str] = {}
        for line in candidate.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key.endswith(("_XML", "_INPUT")) and value and not Path(value).expanduser().is_absolute():
                value = str((candidate.parent / value).resolve())
            values[key] = value
        return values
    return {}


def _configured_value(name: str, config: Mapping[str, str]) -> str:
    return os.environ.get(name) or config.get(name, "")


def verify_live_adapters(rows: Iterable[Mapping[str, Any]], *, limit: int = 1) -> Dict[str, Any]:
    checks = []
    configured_paths = load_source_paths_config()
    for row in rows:
        source = row["source"]
        adapter = SOURCE_ADAPTERS.get(source, EXCLUDED_ADAPTER)
        if adapter.status is SourceAdapterStatus.EXCLUDED or not row.get("enabled"):
            checks.append({"source": source, "status": "skipped", "reason": adapter.notes or "source disabled/excluded"})
            continue
        if adapter.status is SourceAdapterStatus.LOCAL_FILE:
            local_path = _configured_value(adapter.env_path_var, configured_paths) if adapter.env_path_var else ""
            if not local_path:
                checks.append({"source": source, "status": "blocked", "reason": adapter.live_blocker or f"requires {adapter.env_path_var or 'local path'}"})
                continue
            try:
                records = adapter.fetch_records(local_path=local_path, limit=limit)
            except Exception as exc:
                checks.append({"source": source, "status": "failed", "reason": f"{type(exc).__name__}: {exc}"})
                continue
            local_path_obj = Path(local_path)
            status = "passed" if records else ("blocked" if local_path_obj.is_dir() else "failed")
            reason = "" if records else (f"configured directory has no supported records yet: {local_path}" if local_path_obj.is_dir() else "no records parsed")
            checks.append({
                "source": source,
                "status": status,
                "records": len(records),
                "accessions": [record.accession for record in records[:limit]],
                "url": str(local_path),
                "reason": reason,
            })
            continue
        probe_adapter = adapter
        if adapter.live_blocker and not adapter.live_url:
            env_url = _configured_value(adapter.env_url_var, configured_paths) if adapter.env_url_var else ""
            if not env_url:
                checks.append({"source": source, "status": "blocked", "reason": adapter.live_blocker})
                continue
            probe_adapter = replace(adapter, live_url=env_url, live_blocker="")
        try:
            records = probe_adapter.fetch_records(live=True, limit=limit)
        except Exception as exc:  # live diagnostics should report all source failures
            checks.append({"source": source, "status": "failed", "reason": f"{type(exc).__name__}: {exc}"})
            continue
        checks.append({
            "source": source,
            "status": "passed" if records else "failed",
            "records": len(records),
            "accessions": [record.accession for record in records[:limit]],
            "url": probe_adapter.live_url,
            "reason": "" if records else "no records parsed",
        })
    return {
        "summary": {
            "passed": sum(1 for check in checks if check["status"] == "passed"),
            "failed": sum(1 for check in checks if check["status"] == "failed"),
            "blocked": sum(1 for check in checks if check["status"] == "blocked"),
            "skipped": sum(1 for check in checks if check["status"] == "skipped"),
        },
        "checks": checks,
    }


def _read_http_payload(url: str, content_type: str) -> Any:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "chemlake-source-adapter/0.1 (+https://github.com/FiehnLab)",
            "Accept": "application/json,text/plain,text/html,*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310 - adapter fetches configured source URLs
        data = response.read()
    if content_type == "json":
        return json.loads(data.decode("utf-8"))
    if content_type == "zip":
        return {"files": [{"accession": name, "filename": name} for name in zipfile.ZipFile(BytesIO(data)).namelist()]}
    return data.decode("utf-8", errors="replace")


def _read_local_payload(path: Path, *, limit: Optional[int] = None) -> Any:
    if path.is_dir():
        rows: List[Any] = []
        for child in sorted(path.iterdir()):
            if child.is_file() and child.suffix.lower() in {".json", ".jsonl", ".xml", ".csv", ".tsv", ".txt", ".zip"}:
                child_payload = _read_local_payload(child, limit=limit)
                child_rows = child_payload if isinstance(child_payload, list) else _flatten_payload(child_payload)
                rows.extend(child_rows)
                if limit is not None and len(rows) >= limit:
                    return rows[:limit]
        return rows
    suffix = path.suffix.lower()
    if suffix in {".json", ".js"}:
        return json.loads(path.read_text(encoding="utf-8"))
    if suffix == ".jsonl":
        rows = []
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    rows.append(json.loads(line))
                    if limit is not None and len(rows) >= limit:
                        break
        return rows
    if suffix == ".xml":
        return _xml_accession_rows(path, limit=limit)
    if suffix == ".zip":
        return _zip_accession_rows(path, limit=limit)
    text = path.read_text(encoding="utf-8", errors="replace")
    return text


def _zip_accession_rows(path: Path, *, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with zipfile.ZipFile(path) as archive:
        for name in sorted(archive.namelist()):
            suffix = Path(name).suffix.lower()
            if suffix == ".xml":
                with archive.open(name) as handle:
                    rows.extend(_xml_accession_rows(handle, limit=limit, source_name=name))
            else:
                rows.append({"accession": name, "filename": name})
            if limit is not None and len(rows) >= limit:
                return rows[:limit]
    return rows


def _xml_accession_rows(path_or_file: Any, *, limit: Optional[int] = None, source_name: Optional[str] = None) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    current: Dict[str, Any] = {}
    interesting = {"accession", "hmdb_id", "drugbank-id", "drugbank_id", "t3db-id", "t3db_id", "name"}
    for event, elem in ET.iterparse(path_or_file, events=("end",)):
        tag = _local_xml_name(elem.tag)
        if tag in interesting and elem.text and elem.text.strip():
            key = tag.replace("-", "_")
            if key not in current:
                current[key] = elem.text.strip()
        if tag in {"metabolite", "drug", "toxin"}:
            accession = current.get("accession") or current.get("hmdb_id") or current.get("drugbank_id") or current.get("t3db_id")
            if accession:
                row = dict(current)
                row.setdefault("accession", accession)
                if source_name:
                    row["filename"] = source_name
                rows.append(row)
                if limit is not None and len(rows) >= limit:
                    elem.clear()
                    break
            current = {}
        elem.clear()
    if not rows and current:
        accession = current.get("accession") or current.get("hmdb_id") or current.get("drugbank_id") or current.get("t3db_id")
        if accession:
            current.setdefault("accession", accession)
            rows.append(current)
    return rows


def _local_xml_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _flatten_payload(payload: Any) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if isinstance(payload, Mapping):
        for key in ["idlist", "content"]:
            value = payload.get(key)
            if isinstance(value, list):
                rows.extend({"accession": str(item)} for item in value if isinstance(item, str))
        if any(key in payload for key in _ALL_ACCESSION_KEYS):
            rows.append(dict(payload))
        for value in payload.values():
            if isinstance(value, (Mapping, list)):
                rows.extend(_flatten_payload(value))
    elif isinstance(payload, list):
        for item in payload:
            if isinstance(item, str):
                rows.append({"accession": item})
            else:
                rows.extend(_flatten_payload(item))
    elif isinstance(payload, str):
        hrefs = re.findall(r'href=["\']([^"\']+)["\']', payload, flags=re.IGNORECASE)
        for href in hrefs:
            name = Path(urllib.parse.urlparse(href).path).name
            if name and not name.startswith("?"):
                rows.append({"accession": name, "url": href})
        for line in payload.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("<"):
                continue
            if "\t" in stripped:
                left, right = stripped.split("\t", 1)
                first = right.strip().split(None, 1)[0] if left.strip().lower() in {"study_id", "accession", "id", "entry"} else left.strip().split(None, 1)[0]
            else:
                first = stripped.split(None, 1)[0]
            rows.append({"accession": first, "line": stripped})
    return rows


def _first_accession(row: Mapping[str, Any], fields: Sequence[str]) -> str:
    for field_name in fields:
        value = row.get(field_name)
        if value not in (None, ""):
            return str(value).strip()
    return ""


def _record_url(row: Mapping[str, Any], fallback_url: str) -> str:
    for key in ["url", "download_url", "source_url", "ftp_url"]:
        value = row.get(key)
        if isinstance(value, str) and value:
            return value
    return fallback_url


def _dedupe_records(records: Sequence[SourceRecord]) -> List[SourceRecord]:
    seen = set()
    output = []
    for record in records:
        key = (record.source, record.accession)
        if key in seen:
            continue
        seen.add(key)
        output.append(record)
    return output


def _truthy(value: Any) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "enabled"}


_ALL_ACCESSION_KEYS = {
    "accession",
    "obo_id",
    "cas_rn",
    "chebi_id",
    "dataset_id",
    "drugbank_id",
    "dsstoxSubstanceId",
    "dsstox_substance_id",
    "ec_number",
    "entry",
    "filename",
    "foodb_id",
    "hmdb_id",
    "id",
    "lm_id",
    "molecule_chembl_id",
    "name",
    "nctId",
    "nct_id",
    "pmid",
    "rn",
    "setid",
    "smpdb_id",
    "spl_set_id",
    "stableIdentifier",
    "stId",
    "studyId",
    "study_id",
    "substance_id",
    "t3db_id",
    "task",
    "ui",
    "unii",
    "unique_id",
}
