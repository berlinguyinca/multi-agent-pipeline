"""Minimal HTTP/FTP downloader with optional checksum verification."""
from __future__ import annotations
import hashlib
import logging
import shutil
import urllib.request
from pathlib import Path

log = logging.getLogger(__name__)


def download_archive(url: str, dest, checksum: str = None, algo: str = "md5") -> Path:
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url) as resp, tmp.open("wb") as fh:
        shutil.copyfileobj(resp, fh)
    if checksum:
        h = hashlib.new(algo)
        with tmp.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                h.update(chunk)
        if h.hexdigest().lower() != checksum.lower():
            tmp.unlink(missing_ok=True)
            raise ValueError(f"checksum mismatch for {url}: got {h.hexdigest()}")
    tmp.replace(dest)
    return dest
