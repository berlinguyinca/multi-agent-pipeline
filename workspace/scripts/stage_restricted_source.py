#!/usr/bin/env python3
"""Stage a licensed or externally downloaded source snapshot for Chemlake.

This script never logs in to restricted services. It copies an operator-provided
snapshot into the Chemlake work area, writes a checksum manifest, and prints the
environment variable needed by `chemlake sources verify-live`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

ENV_BY_SOURCE = {
    "hmdb": "HMDB_XML",
    "drugbank": "DRUGBANK_INPUT",
    "t3db": "T3DB_INPUT",
}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Stage an operator-provided Chemlake source snapshot")
    parser.add_argument("--source", required=True, choices=sorted(ENV_BY_SOURCE))
    parser.add_argument("--input", required=True, help="Downloaded XML/JSON/JSONL/CSV snapshot path")
    parser.add_argument("--chemlake-root", default=".", help="Chemlake root; defaults to current directory")
    parser.add_argument("--copy", action="store_true", help="Copy into <chemlake-root>/work/sources/<source>/ instead of referencing in place")
    args = parser.parse_args(argv)

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.is_file():
        parser.error(f"snapshot does not exist or is not a file: {input_path}")

    source_dir = Path(args.chemlake_root).expanduser().resolve() / "work" / "sources" / args.source
    source_dir.mkdir(parents=True, exist_ok=True)
    staged_path = source_dir / input_path.name if args.copy else input_path
    if args.copy and staged_path != input_path:
        tmp = staged_path.with_suffix(staged_path.suffix + ".part")
        shutil.copy2(input_path, tmp)
        tmp.replace(staged_path)

    digest = _sha256(staged_path)
    manifest = {
        "source": args.source,
        "input_path": str(input_path),
        "staged_path": str(staged_path),
        "sha256": digest,
        "size_bytes": staged_path.stat().st_size,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "env_var": ENV_BY_SOURCE[args.source],
    }
    manifest_path = source_dir / f"{args.source}-snapshot-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({**manifest, "export": f"export {ENV_BY_SOURCE[args.source]}={staged_path}"}, indent=2, sort_keys=True))
    return 0


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
