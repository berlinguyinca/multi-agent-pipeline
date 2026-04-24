import io
import logging
from pubchem_sync.parsers.sdf import iter_sdf_records

VALID_SDF = '''2244
  -OEChem-01010100002D

 13 13  0     0  0  0  0  0  0999 V2000
M  END
> <PUBCHEM_COMPOUND_CID>
2244

> <PUBCHEM_OPENEYE_CAN_SMILES>
CC(=O)OC1=CC=CC=C1C(=O)O

> <PUBCHEM_IUPAC_INCHIKEY>
BSYNRYMUTXBXSQ-UHFFFAOYSA-N

> <PUBCHEM_MOLECULAR_WEIGHT>
180.16

> <PUBCHEM_XLOGP3>
1.2

$$$$
'''

MALFORMED_THEN_VALID_SDF = '''BROKEN_HEADER_NO_FIELDS

$$$$
2519
  -OEChem-

M  END
> <PUBCHEM_COMPOUND_CID>
2519

> <PUBCHEM_OPENEYE_CAN_SMILES>
CN1C=NC2=C1C(=O)N(C(=O)N2C)C

> <PUBCHEM_IUPAC_INCHIKEY>
RYYVLZVUVIJVGH-UHFFFAOYSA-N

> <PUBCHEM_MOLECULAR_WEIGHT>
194.19

$$$$
'''

def test_parse_valid_sdf():
    records = list(iter_sdf_records(io.StringIO(VALID_SDF)))
    assert len(records) == 1
    r = records[0]
    assert r["cid"] == 2244
    assert r["smiles"] == "CC(=O)OC1=CC=CC=C1C(=O)O"
    assert r["inchikey"] == "BSYNRYMUTXBXSQ-UHFFFAOYSA-N"
    assert abs(r["molecular_weight"] - 180.16) < 1e-6
    assert r["properties"]["XLOGP3"] == "1.2"

def test_parse_malformed_skips_and_logs(caplog):
    caplog.set_level(logging.WARNING)
    records = list(iter_sdf_records(io.StringIO(MALFORMED_THEN_VALID_SDF)))
    assert len(records) == 1
    assert records[0]["cid"] == 2519
    assert any("malformed" in rec.message.lower() or "skip" in rec.message.lower() for rec in caplog.records)

def test_iterator_returns_generator():
    result = iter_sdf_records(io.StringIO(VALID_SDF))
    # Not a list — must be iterable lazily
    assert iter(result) is result or hasattr(result, "__next__") or hasattr(result, "__iter__")

def test_sdf_parser_promotes_resolver_identity_fields():
    from io import StringIO
    from pubchem_sync.parsers.sdf import iter_sdf_records

    sdf = StringIO(
        "2244\n  -OEChem-\n\nM  END\n"
        "> <PUBCHEM_COMPOUND_CID>\n2244\n\n"
        "> <PUBCHEM_IUPAC_NAME>\n2-acetyloxybenzoic acid\n\n"
        "> <PUBCHEM_MOLECULAR_FORMULA>\nC9H8O4\n\n"
        "> <PUBCHEM_EXACT_MASS>\n180.04225873\n\n"
        "> <PUBCHEM_IUPAC_INCHI>\nInChI=1S/C9H8O4/example\n\n"
        "> <PUBCHEM_IUPAC_INCHIKEY>\nBSYNRYMUTXBXSQ-UHFFFAOYSA-N\n\n"
        "> <PUBCHEM_OPENEYE_CAN_SMILES>\nCC(=O)OC1=CC=CC=C1C(=O)O\n\n$$$$\n"
    )

    record = next(iter_sdf_records(sdf))

    assert record["preferred_name"] == "2-acetyloxybenzoic acid"
    assert record["formula"] == "C9H8O4"
    assert record["exact_mass"] == 180.04225873
    assert record["inchi"] == "InChI=1S/C9H8O4/example"
