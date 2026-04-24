import re
import pytest
from pubchem_sync.converter import record_to_markdown, write_markdown

RECORD = {
    "cid": 2244,
    "smiles": "CC(=O)OC1=CC=CC=C1C(=O)O",
    "inchikey": "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
    "molecular_weight": 180.16,
    "properties": {
        "XLOGP3": "1.2",
        "H-Bond Donors": "1",
        "H-Bond Acceptors": "4",
    },
}

def _parse_frontmatter(md):
    m = re.match(r"---\n(.*?)\n---\n", md, re.DOTALL)
    assert m, f"no frontmatter in:\n{md[:200]}"
    fm = {}
    for line in m.group(1).splitlines():
        k, _, v = line.partition(":")
        fm[k.strip()] = v.strip().strip('"')
    return fm, md[m.end():]

def test_record_to_markdown_has_mandatory_frontmatter():
    md = record_to_markdown(RECORD)
    fm, _ = _parse_frontmatter(md)
    for k in ("cid", "smiles", "inchikey", "molecular_weight"):
        assert k in fm, f"missing {k}"
    assert fm["cid"] == "2244"
    assert fm["molecular_weight"] == "180.16"

def test_record_to_markdown_body_has_properties_table():
    md = record_to_markdown(RECORD)
    _, body = _parse_frontmatter(md)
    assert "## Properties" in body
    assert "XLOGP3" in body
    assert "H-Bond Donors" in body
    assert "|" in body

def test_record_missing_mandatory_raises():
    bad = dict(RECORD)
    del bad["smiles"]
    with pytest.raises(ValueError):
        record_to_markdown(bad)

def test_write_markdown_uses_cid_filename(tmp_path):
    path = write_markdown(RECORD, tmp_path)
    assert path.name == "2244.md"
    assert path.exists()
    content = path.read_text()
    assert "cid: 2244" in content

def test_write_markdown_atomic(tmp_path):
    write_markdown(RECORD, tmp_path)
    assert not any(p.suffix == ".tmp" for p in tmp_path.iterdir())

def test_record_to_markdown_preserves_resolver_optional_identity_fields():
    rec = dict(RECORD)
    rec.update(
        {
            "preferred_name": "Aspirin",
            "synonyms": ["acetylsalicylic acid", "ASA"],
            "formula": "C9H8O4",
            "exact_mass": 180.04225873,
            "inchi": "InChI=1S/C9H8O4/example",
            "xrefs": {"hmdb": ["HMDB0001879"], "chebi": ["CHEBI:15365"]},
        }
    )

    md = record_to_markdown(rec)
    fm, body = _parse_frontmatter(md)

    assert fm["preferred_name"] == "Aspirin"
    assert fm["formula"] == "C9H8O4"
    assert fm["exact_mass"] == "180.04225873"
    assert "## Resolver Identity" in body
    assert "acetylsalicylic acid" in body
    assert "HMDB0001879" in body
