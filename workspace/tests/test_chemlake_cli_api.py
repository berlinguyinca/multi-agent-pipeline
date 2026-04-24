import csv
import json

from chem_evidence.api import handle_post
from chem_evidence.cli import main

from .test_resolver import ASPIRIN_KEY, make_lake


def test_api_resolve_discover_and_translate_delegate_to_local_resolver(tmp_path):
    lake = make_lake(tmp_path)

    resolve = handle_post(
        "/resolve",
        {"queries": ["CID:2244"], "to": ["inchikey", "smiles"], "confidence": True, "data_dir": str(lake)},
    )
    assert resolve["status"] == 200
    assert resolve["body"]["results"][0]["matches"][0]["outputs"]["inchikey"] == ASPIRIN_KEY

    translate = handle_post(
        "/translate",
        {"queries": ["aspirin"], "to": ["pubchem_cid"], "confidence": True, "data_dir": str(lake)},
    )
    assert translate["status"] == 200
    assert translate["body"]["endpoint"] == "/resolve"
    assert translate["body"]["results"][0]["matches"][0]["outputs"]["pubchem_cid"] == ["2244"]

    discover = handle_post(
        "/discover",
        {"text": "aspirin CID:2244", "to": "all", "confidence": True, "data_dir": str(lake)},
    )
    assert discover["status"] == 200
    assert len(discover["body"]["discovered"]) >= 2


def test_chemlake_cli_resolve_json_and_csv_stdin(tmp_path, capsys, monkeypatch):
    lake = make_lake(tmp_path)

    assert main(["--data-dir", str(lake), "resolve", "--input", "-", "--to", "inchikey,pubchem_cid", "--confidence"], stdin=["CID:2244\n"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["results"][0]["matches"][0]["outputs"]["inchikey"] == ASPIRIN_KEY

    input_file = tmp_path / "queries.txt"
    input_file.write_text("aspirin\nno-such-compound\n", encoding="utf-8")
    assert main([
        "--data-dir",
        str(lake),
        "resolve",
        "--input",
        str(input_file),
        "--to",
        "pubchem_cid,inchikey",
        "--format",
        "csv",
        "--confidence",
    ]) == 0
    rows = list(csv.DictReader(capsys.readouterr().out.splitlines()))
    assert rows[0]["found"] == "true"
    assert rows[0]["pubchem_cid"] == "2244"
    assert rows[1]["found"] == "false"


def test_chemlake_cli_discover_and_translate_alias(tmp_path, capsys):
    lake = make_lake(tmp_path)
    text_file = tmp_path / "text.txt"
    text_file.write_text("Aspirin appears with splash10-0002-0900000000-bcdef", encoding="utf-8")

    assert main(["--data-dir", str(lake), "discover", "--input", str(text_file), "--to", "all", "--confidence"]) == 0
    discovered = json.loads(capsys.readouterr().out)["discovered"]
    assert any(item["text"] == "Aspirin" for item in discovered)
    assert any(item["detected_query_type"] == "splash" for item in discovered)

    assert main(["--data-dir", str(lake), "translate", "--input", str(text_file), "--to", "pubchem_cid", "--confidence"]) == 0
    translated = json.loads(capsys.readouterr().out)
    assert translated["compatibility_alias"] == "translate"
