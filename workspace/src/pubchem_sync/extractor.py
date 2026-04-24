"""Archive extraction that decouples staging from processing directories."""
from __future__ import annotations
import gzip
import shutil
import tarfile
from pathlib import Path
from typing import List


def extract_to_processing(archive, staging_dir, processing_dir) -> List[Path]:
    archive = Path(archive)
    staging_dir = Path(staging_dir)
    processing_dir = Path(processing_dir)
    staging_dir.mkdir(parents=True, exist_ok=True)
    processing_dir.mkdir(parents=True, exist_ok=True)
    staged = []
    if archive.suffixes[-2:] == [".tar", ".gz"] or archive.suffix == ".tgz":
        with tarfile.open(archive, "r:gz") as tf:
            tf.extractall(staging_dir)
            staged = [staging_dir / m.name for m in tf.getmembers() if m.isfile()]
    elif archive.suffix == ".gz":
        target = staging_dir / archive.stem
        with gzip.open(archive, "rb") as src, target.open("wb") as dst:
            shutil.copyfileobj(src, dst)
        staged = [target]
    else:
        target = staging_dir / archive.name
        shutil.copy2(archive, target)
        staged = [target]
    moved = []
    for src in staged:
        if not src.exists():
            continue
        dst = processing_dir / src.name
        shutil.move(str(src), str(dst))
        moved.append(dst)
    return moved
