"""Generate Chemlake resolver routing graph documentation."""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path
from typing import List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from chem_evidence.routing_catalog import (  # noqa: E402
    SUPPORTED_DATABASES,
    render_database_index,
    render_database_readme,
    render_markdown,
    render_mermaid,
    render_svg,
)


def write_docs(docs_dir: Path = ROOT / "docs") -> Tuple[Path, Path, List[Path], Path, Optional[Path]]:
    docs_dir.mkdir(parents=True, exist_ok=True)
    graph_path = docs_dir / "chemlake-resolver-routing.mmd"
    markdown_path = docs_dir / "chemlake-resolver-routing.md"
    svg_path = docs_dir / "chemlake-resolver-routing.svg"
    png_path = docs_dir / "chemlake-resolver-routing.png"
    graph_path.write_text(render_mermaid() + "\n", encoding="utf-8")
    markdown_path.write_text(render_markdown() + "\n", encoding="utf-8")
    svg_path.write_text(render_svg() + "\n", encoding="utf-8")
    rendered_png = _render_png(svg_path, png_path)

    database_dir = docs_dir / "chemlake-resolver-databases"
    database_dir.mkdir(parents=True, exist_ok=True)
    (database_dir / "README.md").write_text(render_database_index() + "\n", encoding="utf-8")
    database_readmes = []
    for item in SUPPORTED_DATABASES:
        readme_dir = database_dir / item.namespace
        readme_dir.mkdir(parents=True, exist_ok=True)
        readme_path = readme_dir / "README.md"
        readme_path.write_text(render_database_readme(item) + "\n", encoding="utf-8")
        database_readmes.append(readme_path)
    return graph_path, markdown_path, database_readmes, svg_path, rendered_png


def _render_png(svg_path: Path, png_path: Path) -> Optional[Path]:
    sips = shutil.which("sips")
    if not sips:
        return None
    subprocess.run([sips, "-s", "format", "png", str(svg_path), "--out", str(png_path)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return png_path


def main() -> int:
    graph_path, markdown_path, database_readmes, svg_path, png_path = write_docs()
    print(f"wrote {graph_path}")
    print(f"wrote {markdown_path}")
    print(f"wrote {svg_path}")
    if png_path:
        print(f"wrote {png_path}")
    else:
        print("skipped PNG render: sips not available")
    print(f"wrote {len(database_readmes)} database README(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
