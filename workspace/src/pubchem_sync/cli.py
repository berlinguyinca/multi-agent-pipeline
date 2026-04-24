"""Command-line interface for pubchem-sync."""
from __future__ import annotations
import argparse
import logging
import sys
from pathlib import Path

from .manifest import Manifest
from .parsers.sdf import iter_sdf_records
from .parsers.xml import iter_xml_compounds
from .converter import write_markdown


def _build_parser():
    p = argparse.ArgumentParser(prog="pubchem-sync", description="PubChem FTP sync and Markdown converter")
    sub = p.add_subparsers(dest="cmd")

    c = sub.add_parser("convert", help="Convert SDF/XML to Markdown")
    c.add_argument("--input", required=True)
    c.add_argument("--output", required=True)
    c.add_argument("--format", choices=("sdf", "xml"), required=True)

    cl = sub.add_parser("clean", help="Prune local manifest entries missing from remote list")
    cl.add_argument("--manifest", required=True)
    cl.add_argument("--remote-list", required=True)
    cl.add_argument("--output", required=False)

    return p


def _cmd_convert(args) -> int:
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    count = 0
    if args.format == "sdf":
        with open(args.input, "r", encoding="utf-8", errors="replace") as fh:
            for rec in iter_sdf_records(fh):
                write_markdown(rec, out)
                count += 1
    else:
        for rec in iter_xml_compounds(args.input):
            write_markdown(rec, out)
            count += 1
    print(f"converted {count} record(s) to {out}", file=sys.stderr)
    return 0


def _cmd_clean(args) -> int:
    with Manifest(args.manifest) as m:
        with open(args.remote_list) as fh:
            remote = {line.strip() for line in fh if line.strip()}
        orphans = m.find_orphans(remote)
        for name in orphans:
            m.remove(name)
            if args.output:
                stem = name.split(".")[0]
                candidate = Path(args.output) / f"{stem}.md"
                if candidate.exists():
                    candidate.unlink()
        print(f"pruned {len(orphans)} orphan(s)", file=sys.stderr)
    return 0


def main(argv=None) -> int:
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.cmd == "convert":
        return _cmd_convert(args)
    if args.cmd == "clean":
        return _cmd_clean(args)
    parser.print_help()
    return 0 if argv == ["--help"] else 2


if __name__ == "__main__":
    sys.exit(main())
