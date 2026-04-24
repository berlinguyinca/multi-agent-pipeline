import json

from chem_evidence.resolver import ChemlakeResolver, classify_query


ASPIRIN_INCHI = "InChI=1S/C9H8O4/c1-6(10)13-8-5-3-2-4-7(8)9(11)12/h2-5H,1H3,(H,11,12)"
ASPIRIN_KEY = "BSYNRYMUTXBXSQ-UHFFFAOYSA-N"


def write_jsonl(path, rows):
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def make_lake(tmp_path):
    lake = tmp_path / "lake"
    lake.mkdir()
    write_jsonl(
        lake / "compound_identity.jsonl",
        [
            {
                "id": "chemlake:aspirin",
                "preferred_name": "Aspirin",
                "synonyms": ["acetylsalicylic acid", "ASA"],
                "formula": "C9H8O4",
                "exact_mass": 180.04225873,
                "monoisotopic_mass": 180.04225873,
                "inchi": ASPIRIN_INCHI,
                "inchikey": ASPIRIN_KEY,
                "smiles": "CC(=O)OC1=CC=CC=C1C(=O)O",
                "xrefs": {
                    "pubchem_cid": ["2244"],
                    "hmdb": ["HMDB0001879"],
                    "chebi": ["CHEBI:15365"],
                    "kegg": ["C01405"],
                    "drugbank": ["DB00945"],
                    "cas": ["50-78-2"],
                },
            },
            {
                "id": "chemlake:asa-control",
                "preferred_name": "Arsanilic acid",
                "synonyms": ["ASA"],
                "formula": "C6H8AsNO3",
                "exact_mass": 216.972,
                "inchikey": "MRKWPZXWRCSSFL-UHFFFAOYSA-N",
                "smiles": "NC1=CC=C(C=C1)As(O)(O)=O",
                "xrefs": {"pubchem_cid": ["234"], "cas": ["98-50-0"]},
            },
        ],
    )
    write_jsonl(
        lake / "xrefs.jsonl",
        [
            {
                "compound_id": "chemlake:aspirin",
                "namespace": "comptox",
                "identifier": "DTXSID5020108",
                "source": "CompTox",
                "retrieved_at": "2026-04-01T00:00:00Z",
            }
        ],
    )
    write_jsonl(
        lake / "synonyms.jsonl",
        [
            {
                "compound_id": "chemlake:aspirin",
                "name": "2-acetoxybenzoic acid",
                "source": "PubChem synonym",
            }
        ],
    )
    write_jsonl(
        lake / "spectra.jsonl",
        [
            {
                "compound_id": "chemlake:aspirin",
                "splash": "splash10-0002-0900000000-bcdef",
                "source": "MassBank",
            }
        ],
    )
    write_jsonl(
        lake / "evidence.jsonl",
        [
            {
                "compound_id": "chemlake:aspirin",
                "literature_count": 123,
                "patent_count": 7,
                "usage": {"pharmaceutical": "yes"},
                "commonness": {"label": "common", "score": 92},
            }
        ],
    )
    (lake / "manifest.json").write_text(
        json.dumps({"sources": {"PubChem": {"retrieved_at": "2026-04-01T00:00:00Z"}}}),
        encoding="utf-8",
    )
    return lake


def test_classify_query_covers_cts_and_cactus_identifier_shapes():
    examples = {
        "CID:2244": "pubchem_cid",
        "SID:12345": "pubchem_sid",
        "50-78-2": "cas",
        "HMDB0001879": "hmdb",
        "CHEBI:15365": "chebi",
        "C01405": "kegg",
        "LMFA01010001": "lipidmaps",
        "DB00945": "drugbank",
        "DTXSID5020108": "comptox",
        ASPIRIN_KEY: "inchikey",
        "BSYNRYMUTXBXSQ": "inchikey_block1",
        ASPIRIN_INCHI: "inchi",
        "CC(=O)OC1=CC=CC=C1C(=O)O": "smiles",
        "C9H8O4": "formula",
        "splash10-0002-0900000000-bcdef": "splash",
        "aspirin": "name",
    }
    for query, expected in examples.items():
        detected = classify_query(query)
        assert detected.namespace == expected, query
        assert detected.valid is True
    assert classify_query("not an inchikey with spaces").namespace == "name"
    assert classify_query("BSYNRYMUTXBXSQ-UHFFFAOYSA").valid is False


def test_resolve_exact_identifier_returns_all_outputs_confidence_and_provenance(tmp_path):
    resolver = ChemlakeResolver.from_directory(make_lake(tmp_path))

    result = resolver.resolve_one("CID:2244", to="all", include_confidence=True)

    assert result["found"] is True
    assert result["detected_query_type"] == "pubchem_cid"
    match = result["matches"][0]
    assert match["compound_id"] == "chemlake:aspirin"
    assert match["match_level"] == "exact_identifier"
    assert match["confidence"] > 0.9
    assert match["outputs"]["inchikey"] == ASPIRIN_KEY
    assert match["outputs"]["names"][0] == "Aspirin"
    assert match["outputs"]["xrefs"]["hmdb"] == ["HMDB0001879"]
    assert match["knowledge"]["spectra"][0]["splash"].startswith("splash10")
    assert match["knowledge"]["evidence"]["literature_count"] == 123
    assert "PubChem" in match["knowledge"]["freshness"]["sources"]
    assert match["provenance"]


def test_resolve_ranking_confidence_order_for_weaker_match_levels(tmp_path):
    resolver = ChemlakeResolver.from_directory(make_lake(tmp_path))

    exact = resolver.resolve_one(ASPIRIN_KEY, include_confidence=True)["matches"][0]
    first_block = resolver.resolve_one("BSYNRYMUTXBXSQ", include_confidence=True)["matches"][0]
    formula = resolver.resolve_one("C9H8O4", include_confidence=True)["matches"][0]
    synonym_result = resolver.resolve_one("ASA", include_confidence=True)

    assert exact["confidence"] > synonym_result["matches"][0]["confidence"]
    assert synonym_result["matches"][0]["confidence"] > first_block["confidence"]
    assert first_block["confidence"] > formula["confidence"]
    assert synonym_result["warnings"] == ["ambiguous query matched multiple compounds"]
    assert {m["compound_id"] for m in synonym_result["matches"]} == {
        "chemlake:aspirin",
        "chemlake:asa-control",
    }


def test_discover_extracts_overlapping_names_and_identifiers_without_duplicates(tmp_path):
    resolver = ChemlakeResolver.from_directory(make_lake(tmp_path))

    result = resolver.discover(
        "Aspirin (acetylsalicylic acid, CID:2244) has InChIKey BSYNRYMUTXBXSQ-UHFFFAOYSA-N.",
        to=["pubchem_cid", "inchikey", "smiles"],
        include_confidence=True,
    )

    discovered = result["discovered"]
    assert [item["text"] for item in discovered].count("Aspirin") == 1
    assert any(item["detected_query_type"] == "pubchem_cid" for item in discovered)
    assert any(item["detected_query_type"] == "inchikey" for item in discovered)
    assert all(item["result"]["found"] for item in discovered)
    # The longer synonym should win over its contained token and still resolve to aspirin.
    assert any(item["text"] == "acetylsalicylic acid" for item in discovered)
