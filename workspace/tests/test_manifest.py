from pubchem_sync.manifest import Manifest

def test_manifest_creates_schema(tmp_path):
    m = Manifest(tmp_path / "manifest.db")
    assert (tmp_path / "manifest.db").exists()
    m.close()

def test_manifest_record_dataset(tmp_path):
    m = Manifest(tmp_path / "manifest.db")
    m.record_dataset("Compound_000000001_000500000.sdf.gz", version="2026-04", checksum="abc123")
    rows = m.list_datasets()
    assert len(rows) == 1
    assert rows[0]["name"] == "Compound_000000001_000500000.sdf.gz"
    assert rows[0]["status"] == "pending"
    m.close()

def test_manifest_mark_status(tmp_path):
    m = Manifest(tmp_path / "manifest.db")
    m.record_dataset("a.sdf.gz", version="v1", checksum="x")
    m.mark_status("a.sdf.gz", "downloaded")
    m.mark_status("a.sdf.gz", "converted")
    rows = m.list_datasets()
    assert rows[0]["status"] == "converted"
    m.close()

def test_manifest_prune_identifies_orphans(tmp_path):
    m = Manifest(tmp_path / "manifest.db")
    m.record_dataset("a.sdf.gz", "v1", "x")
    m.record_dataset("b.sdf.gz", "v1", "y")
    m.record_dataset("c.sdf.gz", "v1", "z")
    orphans = m.find_orphans({"a.sdf.gz", "c.sdf.gz"})
    assert orphans == ["b.sdf.gz"]
    m.close()

def test_manifest_remove(tmp_path):
    m = Manifest(tmp_path / "manifest.db")
    m.record_dataset("a.sdf.gz", "v1", "x")
    m.remove("a.sdf.gz")
    assert m.list_datasets() == []
    m.close()
