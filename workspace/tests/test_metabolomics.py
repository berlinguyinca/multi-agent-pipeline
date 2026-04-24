import json
from pathlib import Path

from chem_evidence.metabolomics import MetabolomicsHarvester, MetabolomicsIndex
from chem_evidence.resolver import ChemlakeResolver
from .test_resolver import make_lake


class FixtureTransport:
    def __init__(self, payloads):
        self.payloads = payloads
        self.urls = []

    def get_json(self, url):
        self.urls.append(url)
        if url not in self.payloads:
            raise AssertionError(f"unexpected url: {url}")
        return self.payloads[url]


def test_metabolomics_workbench_harvest_normalizes_results_metadata_and_governance(tmp_path):
    transport = FixtureTransport(
        {
            "https://www.metabolomicsworkbench.org/rest/study/study_id/ST000001/summary/json": {
                "study_id": "ST000001",
                "title": "Mouse liver knockout metabolomics",
                "organism": "Mus musculus",
                "species": "mouse",
                "organ": "liver",
                "genotype": "Ppara -/-",
                "disease": "fatty liver",
                "pmid": "12345678",
                "doi": "10.1000/example",
            },
            "https://www.metabolomicsworkbench.org/rest/study/study_id/ST000001/factors/json": [
                {"sample_id": "S1", "factor": "genotype", "value": "Ppara -/-"},
                {"sample_id": "S1", "factor": "organ", "value": "liver"},
            ],
            "https://www.metabolomicsworkbench.org/rest/study/study_id/ST000001/datatable/json": [
                {
                    "analysis_id": "AN000001",
                    "sample_id": "S1",
                    "metabolite_name": "aspirin",
                    "pubchem_cid": "2244",
                    "inchikey": "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
                    "abundance": "42.5",
                    "unit": "uM",
                }
            ],
        }
    )
    harvester = MetabolomicsHarvester(transport=transport, retrieved_at="2026-04-23T00:00:00Z")

    summary = harvester.harvest("mw", tmp_path, accessions=["ST000001"])

    assert summary["source"] == "mw"
    assert summary["studies"] == 1
    assert summary["samples"] == 1
    assert summary["results"] == 1
    study = _read_jsonl(tmp_path / "metabolomics" / "studies.jsonl")[0]
    result = _read_jsonl(tmp_path / "metabolomics" / "results.jsonl")[0]
    provenance = _read_jsonl(tmp_path / "metabolomics" / "provenance.jsonl")

    assert study["source_name"] == "Metabolomics Workbench"
    assert study["source_accession"] == "ST000001"
    assert study["species"] == "mouse"
    assert study["organ"] == "liver"
    assert study["genotype"] == "Ppara -/-"
    assert study["pmids"] == ["12345678"]
    assert result["metabolite_name"] == "aspirin"
    assert result["pubchem_cid"] == "2244"
    assert result["abundance"] == 42.5
    for row in [study, result, provenance[0]]:
        assert row["retrieved_at"] == "2026-04-23T00:00:00Z"
        assert row["content_hash"].startswith("sha256:")
        assert row["parser_version"]
        assert row["license_terms_note"]


def test_pubmed_harvest_links_publication_metadata(tmp_path):
    transport = FixtureTransport(
        {
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=12345678&retmode=json": {
                "result": {
                    "uids": ["12345678"],
                    "12345678": {
                        "uid": "12345678",
                        "title": "A liver metabolomics study",
                        "fulljournalname": "Metabolomics Journal",
                        "pubdate": "2025 Jan",
                        "articleids": [{"idtype": "doi", "value": "10.1000/example"}],
                    },
                }
            }
        }
    )
    harvester = MetabolomicsHarvester(transport=transport, retrieved_at="2026-04-23T00:00:00Z")

    summary = harvester.harvest("pubmed", tmp_path, pmids=["12345678"])

    publication = _read_jsonl(tmp_path / "metabolomics" / "publications.jsonl")[0]
    assert summary["publications"] == 1
    assert publication["pmid"] == "12345678"
    assert publication["doi"] == "10.1000/example"
    assert publication["title"] == "A liver metabolomics study"
    assert publication["source_name"] == "PubMed"
    assert publication["source_url"].endswith("id=12345678&retmode=json")


def test_metabolomics_index_builds_duckdb_parquet_and_queries_biological_context(tmp_path):
    lake = make_lake(tmp_path)
    metabolomics = lake / "metabolomics"
    metabolomics.mkdir()
    _write_jsonl(
        metabolomics / "studies.jsonl",
        [
            {
                "study_id": "ST000001",
                "title": "Mouse liver knockout metabolomics",
                "source_name": "Metabolomics Workbench",
                "source_accession": "ST000001",
                "source_url": "https://example.test/ST000001",
                "species": "mouse",
                "organ": "liver",
                "genotype": "Ppara -/-",
                "disease": "fatty liver",
                "pmids": ["12345678"],
                "retrieved_at": "2026-04-23T00:00:00Z",
                "content_hash": "sha256:test",
                "parser_version": "test",
                "license_terms_note": "test fixture",
            }
        ],
    )
    _write_jsonl(
        metabolomics / "samples.jsonl",
        [
            {
                "sample_id": "S1",
                "study_id": "ST000001",
                "species": "mouse",
                "organ": "liver",
                "genotype": "Ppara -/-",
                "disease": "fatty liver",
                "factors": {"diet": "high fat"},
                "source_name": "Metabolomics Workbench",
                "source_accession": "ST000001",
                "source_url": "https://example.test/ST000001",
                "retrieved_at": "2026-04-23T00:00:00Z",
                "content_hash": "sha256:test",
                "parser_version": "test",
                "license_terms_note": "test fixture",
            }
        ],
    )
    _write_jsonl(
        metabolomics / "results.jsonl",
        [
            {
                "result_id": "ST000001:AN000001:S1:aspirin",
                "study_id": "ST000001",
                "analysis_id": "AN000001",
                "sample_id": "S1",
                "metabolite_name": "aspirin",
                "pubchem_cid": "2244",
                "inchikey": "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
                "abundance": 42.5,
                "unit": "uM",
                "source_name": "Metabolomics Workbench",
                "source_accession": "ST000001",
                "source_url": "https://example.test/ST000001",
                "retrieved_at": "2026-04-23T00:00:00Z",
                "content_hash": "sha256:test",
                "parser_version": "test",
                "license_terms_note": "test fixture",
            }
        ],
    )
    _write_jsonl(
        metabolomics / "publications.jsonl",
        [
            {
                "pmid": "12345678",
                "doi": "10.1000/example",
                "title": "A liver metabolomics study",
                "journal": "Metabolomics Journal",
                "publication_date": "2025 Jan",
                "source_name": "PubMed",
                "source_accession": "12345678",
                "source_url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=12345678&retmode=json",
                "retrieved_at": "2026-04-23T00:00:00Z",
                "content_hash": "sha256:test",
                "parser_version": "test",
                "license_terms_note": "NCBI E-utilities",
            }
        ],
    )

    index = MetabolomicsIndex.build(lake)
    rows = index.query(compound="aspirin", species="mouse", organ="liver", genotype="Ppara -/-")

    assert (metabolomics / "index.duckdb").exists()
    assert (metabolomics / "results.parquet").exists()
    assert rows[0]["study_id"] == "ST000001"
    assert rows[0]["metabolite_name"] == "aspirin"
    assert rows[0]["publication_title"] == "A liver metabolomics study"
    assert rows[0]["source_name"] == "Metabolomics Workbench"

    resolver = ChemlakeResolver.from_directory(lake)
    resolved = resolver.resolve_one("CID:2244", to="all", include_confidence=True)
    assert resolved["matches"][0]["knowledge"]["metabolomics"]["result_count"] == 1
    assert resolved["matches"][0]["knowledge"]["metabolomics"]["studies"][0]["study_id"] == "ST000001"


def test_cross_repository_harvesters_preserve_source_identity(tmp_path):
    transport = FixtureTransport(
        {
            "https://www.ebi.ac.uk/metabolights/ws/studies/MTBLS1": {
                "study_id": "MTBLS1",
                "title": "Human plasma metabolomics",
                "organism": "Homo sapiens",
                "species": "human",
                "organ": "plasma",
                "pmid": "22222222",
            },
            "https://gnps.ucsd.edu/ProteoSAFe/QueryDataset?task=MSV0001": {
                "dataset_id": "MSV0001",
                "title": "GNPS mouse fecal metabolomics",
                "species": "mouse",
                "organ": "feces",
                "usi": "mzspec:MSV0001:file:scan:1",
            },
            "https://www.metabolomexchange.org/api/studies/MXE0001": {
                "study_id": "MXE0001",
                "title": "Aggregator pointer",
                "repository": "MetaboLights",
                "repository_accession": "MTBLS1",
                "pmid": "22222222",
            },
            "https://www.metabolomicshub.org/api/studies/HUB0001": {
                "study_id": "HUB0001",
                "title": "Hub pointer",
                "repository": "Metabolomics Workbench",
                "repository_accession": "ST000001",
            },
        }
    )
    harvester = MetabolomicsHarvester(transport=transport, retrieved_at="2026-04-23T00:00:00Z")

    harvester.harvest("metabolights", tmp_path, accessions=["MTBLS1"])
    harvester.harvest("gnps", tmp_path, accessions=["MSV0001"])
    harvester.harvest("metabolomexchange", tmp_path, accessions=["MXE0001"])
    harvester.harvest("hub", tmp_path, accessions=["HUB0001"])

    studies = _read_jsonl(tmp_path / "metabolomics" / "studies.jsonl")
    by_source = {row["source_name"]: row for row in studies}
    assert by_source["MetaboLights"]["source_accession"] == "MTBLS1"
    assert by_source["GNPS/MassIVE"]["source_accession"] == "MSV0001"
    assert by_source["MetabolomeXchange"]["source_record_type"] == "discovery_record"
    assert by_source["MetabolomicsHub"]["source_record_type"] == "discovery_record"


def _write_jsonl(path: Path, rows):
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def _read_jsonl(path: Path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_metabolomics_cli_index_and_query(tmp_path, capsys):
    from chem_evidence.cli import main

    lake = tmp_path / "lake"
    metabolomics = lake / "metabolomics"
    metabolomics.mkdir(parents=True)
    _write_jsonl(
        metabolomics / "studies.jsonl",
        [
            {
                "study_id": "ST000002",
                "title": "CLI study",
                "source_name": "Metabolomics Workbench",
                "source_accession": "ST000002",
                "source_url": "https://example.test/ST000002",
                "species": "human",
                "organ": "plasma",
                "genotype": None,
                "disease": "control",
                "pmids": [],
                "retrieved_at": "2026-04-23T00:00:00Z",
                "content_hash": "sha256:test",
                "parser_version": "test",
                "license_terms_note": "test fixture",
            }
        ],
    )
    _write_jsonl(
        metabolomics / "results.jsonl",
        [
            {
                "result_id": "r1",
                "study_id": "ST000002",
                "analysis_id": "AN1",
                "sample_id": "S1",
                "metabolite_name": "glucose",
                "pubchem_cid": "5793",
                "inchikey": None,
                "abundance": 12.0,
                "unit": "mM",
                "source_name": "Metabolomics Workbench",
                "source_accession": "ST000002",
                "source_url": "https://example.test/ST000002",
                "retrieved_at": "2026-04-23T00:00:00Z",
                "content_hash": "sha256:test",
                "parser_version": "test",
                "license_terms_note": "test fixture",
            }
        ],
    )

    assert main(["--data-dir", str(lake), "metabolomics", "index"]) == 0
    assert "index.duckdb" in capsys.readouterr().out
    assert main(["--data-dir", str(lake), "metabolomics", "query", "--compound", "glucose", "--species", "human"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["results"][0]["study_id"] == "ST000002"


def test_metabolomics_mirror_all_discovers_downloads_and_tracks_governance(tmp_path):
    from chem_evidence.metabolomics import MetabolomicsMirror

    class MirrorTransport(FixtureTransport):
        def __init__(self):
            super().__init__(
                {
                    "https://www.metabolomicsworkbench.org/rest/study/study_id/all/summary/json": [
                        {
                            "study_id": "ST000001",
                            "title": "Mirror study",
                            "download_url": "https://example.test/ST000001/raw.zip",
                        }
                    ],
                    "https://www.metabolomicsworkbench.org/rest/study/study_id/ST000001/summary/json": {"study_id": "ST000001"},
                    "https://www.metabolomicsworkbench.org/rest/study/study_id/ST000001/factors/json": [],
                    "https://www.metabolomicsworkbench.org/rest/study/study_id/ST000001/datatable/json": [],
                    "https://www.metabolomicsworkbench.org/rest/study/study_id/ST000001/mwtab/txt": "MWTAB",
                }
            )
            self.bytes_payloads = {"https://example.test/ST000001/raw.zip": b"raw-data"}

        def get_bytes(self, url):
            if url in self.payloads:
                value = self.payloads[url]
                return json.dumps(value, sort_keys=True).encode("utf-8") if not isinstance(value, str) else value.encode("utf-8")
            if url not in self.bytes_payloads:
                raise AssertionError(f"unexpected bytes url: {url}")
            return self.bytes_payloads[url]

    mirror = MetabolomicsMirror(transport=MirrorTransport(), retrieved_at="2026-04-23T00:00:00Z")

    summary = mirror.mirror("mw", tmp_path, all_data=True, include_raw=True)

    assert summary["source"] == "mw"
    assert summary["accessions"] == 1
    assert summary["files"] == 5
    manifest = _read_jsonl(tmp_path / "metabolomics" / "mirror" / "mirror_manifest.jsonl")
    assert {row["source_record_type"] for row in manifest} == {"summary", "factors", "datatable", "mwtab", "raw_file"}
    assert all(row["content_hash"].startswith("sha256:") for row in manifest)
    assert all(row["local_path"] for row in manifest)
    assert (tmp_path / manifest[-1]["local_path"]).read_bytes() == b"raw-data"


def test_metabolomics_cli_mirror_requires_explicit_all_or_accession(tmp_path):
    from chem_evidence.cli import main

    try:
        main(["--data-dir", str(tmp_path), "metabolomics", "mirror", "--source", "mw"])
    except SystemExit as exc:
        assert exc.code != 0
    else:
        raise AssertionError("mirror without --all or --accession should fail")
