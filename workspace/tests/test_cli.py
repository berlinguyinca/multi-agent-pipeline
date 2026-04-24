from pubchem_sync.cli import main

def test_cli_help(capsys):
    try:
        main(["--help"])
    except SystemExit as e:
        assert e.code == 0
    out = capsys.readouterr().out
    assert "pubchem" in out.lower() or "usage" in out.lower()

def test_cli_convert_subcommand(tmp_path):
    # Provide a small SDF file, run `convert` and verify .md appears
    sdf = tmp_path / "in.sdf"
    sdf.write_text(
        "2244\n  -OEChem-\n\nM  END\n"
        "> <PUBCHEM_COMPOUND_CID>\n2244\n\n"
        "> <PUBCHEM_OPENEYE_CAN_SMILES>\nCC(=O)OC1=CC=CC=C1C(=O)O\n\n"
        "> <PUBCHEM_IUPAC_INCHIKEY>\nBSYNRYMUTXBXSQ-UHFFFAOYSA-N\n\n"
        "> <PUBCHEM_MOLECULAR_WEIGHT>\n180.16\n\n$$$$\n"
    )
    out_dir = tmp_path / "out"
    rc = main(["convert", "--input", str(sdf), "--output", str(out_dir), "--format", "sdf"])
    assert rc == 0
    assert (out_dir / "2244.md").exists()

def test_cli_clean_flag(tmp_path):
    # Manifest has b.sdf.gz but remote set only lists a.sdf.gz → b removed
    from pubchem_sync.manifest import Manifest
    db = tmp_path / "m.db"
    m = Manifest(db)
    m.record_dataset("a.sdf.gz", "v1", "x")
    m.mark_status("a.sdf.gz", "converted")
    m.record_dataset("b.sdf.gz", "v1", "y")
    m.mark_status("b.sdf.gz", "converted")
    m.close()
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    (out_dir / "a.md").write_text("---\ncid: 1\n---\n")
    (out_dir / "b.md").write_text("---\ncid: 2\n---\n")
    # Synthetic remote-list file
    remote = tmp_path / "remote.txt"
    remote.write_text("a.sdf.gz\n")
    rc = main(["clean", "--manifest", str(db), "--remote-list", str(remote), "--output", str(out_dir)])
    assert rc == 0
    # orphan entry removed from manifest
    m2 = Manifest(db)
    names = [r["name"] for r in m2.list_datasets()]
    m2.close()
    assert "b.sdf.gz" not in names
