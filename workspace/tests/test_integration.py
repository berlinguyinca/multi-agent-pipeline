import resource
from pubchem_sync.parsers.sdf import iter_sdf_records
from pubchem_sync.converter import write_markdown

def _make_sdf_record(cid):
    return (
        f"{cid}\n  -OEChem-\n\nM  END\n"
        f"> <PUBCHEM_COMPOUND_CID>\n{cid}\n\n"
        f"> <PUBCHEM_OPENEYE_CAN_SMILES>\nC{cid}H\n\n"
        f"> <PUBCHEM_IUPAC_INCHIKEY>\nKEY-{cid:08d}-N\n\n"
        f"> <PUBCHEM_MOLECULAR_WEIGHT>\n{100.0 + cid}\n\n$$$$\n"
    )

def test_streaming_large_sdf(tmp_path):
    # Generate 2000-record SDF, stream-convert, verify output count and mem stays bounded
    sdf_path = tmp_path / "big.sdf"
    with sdf_path.open("w") as f:
        for cid in range(1, 2001):
            f.write(_make_sdf_record(cid))
    out = tmp_path / "out"
    out.mkdir()
    count = 0
    with sdf_path.open() as stream:
        for rec in iter_sdf_records(stream):
            write_markdown(rec, out)
            count += 1
    assert count == 2000
    assert (out / "1.md").exists()
    assert (out / "2000.md").exists()
    # Peak RSS stays under 2GB (2*1024*1024 KB). ru_maxrss is KB on Linux, bytes on macOS.
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # Convert: macOS bytes, Linux KB
    rss_mb = rss / (1024 * 1024) if rss > 10_000_000 else rss / 1024
    assert rss_mb < 2048, f"peak RSS {rss_mb:.1f} MB exceeded 2GB"
