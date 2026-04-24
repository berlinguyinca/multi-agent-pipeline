import logging
from pubchem_sync.parsers.xml import iter_xml_compounds

VALID_XML = '''<?xml version="1.0"?>
<PC-Compounds>
  <PC-Compound>
    <PC-Compound_id><PC-CompoundType><PC-CompoundType_id><PC-CompoundType_id_cid>2244</PC-CompoundType_id_cid></PC-CompoundType_id></PC-CompoundType></PC-Compound_id>
    <PC-Compound_props>
      <PC-InfoData>
        <PC-InfoData_urn><PC-Urn><PC-Urn_label>SMILES</PC-Urn_label><PC-Urn_name>Canonical</PC-Urn_name></PC-Urn></PC-InfoData_urn>
        <PC-InfoData_value><PC-InfoData_value_sval>CC(=O)OC1=CC=CC=C1C(=O)O</PC-InfoData_value_sval></PC-InfoData_value>
      </PC-InfoData>
      <PC-InfoData>
        <PC-InfoData_urn><PC-Urn><PC-Urn_label>InChIKey</PC-Urn_label></PC-Urn></PC-InfoData_urn>
        <PC-InfoData_value><PC-InfoData_value_sval>BSYNRYMUTXBXSQ-UHFFFAOYSA-N</PC-InfoData_value_sval></PC-InfoData_value>
      </PC-InfoData>
      <PC-InfoData>
        <PC-InfoData_urn><PC-Urn><PC-Urn_label>Molecular Weight</PC-Urn_label></PC-Urn></PC-InfoData_urn>
        <PC-InfoData_value><PC-InfoData_value_fval>180.16</PC-InfoData_value_fval></PC-InfoData_value>
      </PC-InfoData>
    </PC-Compound_props>
  </PC-Compound>
</PC-Compounds>
'''

MALFORMED_XML = '''<?xml version="1.0"?>
<PC-Compounds>
  <PC-Compound><broken_tag></PC-Compound>
</PC-Compounds>
'''

def test_parse_valid_xml(tmp_path):
    p = tmp_path / "c.xml"
    p.write_text(VALID_XML)
    recs = list(iter_xml_compounds(str(p)))
    assert len(recs) == 1
    r = recs[0]
    assert r["cid"] == 2244
    assert r["smiles"] == "CC(=O)OC1=CC=CC=C1C(=O)O"
    assert r["inchikey"] == "BSYNRYMUTXBXSQ-UHFFFAOYSA-N"
    assert abs(r["molecular_weight"] - 180.16) < 1e-6

def test_parse_malformed_xml_logs(tmp_path, caplog):
    caplog.set_level(logging.WARNING)
    p = tmp_path / "bad.xml"
    p.write_text(MALFORMED_XML)
    recs = list(iter_xml_compounds(str(p)))
    assert recs == []
    assert any("xml" in rec.message.lower() or "parse" in rec.message.lower() for rec in caplog.records)
