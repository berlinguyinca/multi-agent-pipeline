"""Streaming SDF record parser for PubChem Compound files.

Format: records separated by a line containing exactly '$$$$'. Data fields
appear as '> <FIELD_NAME>' followed by one or more value lines and a blank line.
Memory use stays bounded to a single record buffer.
"""
from __future__ import annotations
import logging
from typing import Iterator, Dict, Any, Optional, Callable

log = logging.getLogger(__name__)

_CID_KEY = "PUBCHEM_COMPOUND_CID"
_SMILES_KEYS = ("PUBCHEM_OPENEYE_CAN_SMILES", "PUBCHEM_OPENEYE_ISO_SMILES", "PUBCHEM_SMILES")
_INCHIKEY_KEY = "PUBCHEM_IUPAC_INCHIKEY"
_MW_KEY = "PUBCHEM_MOLECULAR_WEIGHT"
_NAME_KEYS = ("PUBCHEM_IUPAC_NAME", "PUBCHEM_IUPAC_OPENEYE_NAME", "PUBCHEM_IUPAC_CAS_NAME")
_FORMULA_KEY = "PUBCHEM_MOLECULAR_FORMULA"
_EXACT_MASS_KEY = "PUBCHEM_EXACT_MASS"
_INCHI_KEY = "PUBCHEM_IUPAC_INCHI"


def _parse_fields(lines):
    props = {}
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i].rstrip("\n\r")
        if line.startswith("> <") and ">" in line[3:]:
            key = line[3:line.rfind(">")]
            i += 1
            vals = []
            while i < n and lines[i].strip() != "":
                vals.append(lines[i].rstrip("\n\r"))
                i += 1
            props[key] = "\n".join(vals).strip()
        i += 1
    return props


def _build_record(props):
    if _CID_KEY not in props:
        raise ValueError("malformed record: missing PUBCHEM_COMPOUND_CID")
    try:
        cid = int(props.pop(_CID_KEY).strip())
    except ValueError as exc:
        raise ValueError(f"malformed record: non-integer CID ({exc})")
    smiles = None
    for key in _SMILES_KEYS:
        if key in props:
            smiles = props.pop(key)
            break
    inchikey = props.pop(_INCHIKEY_KEY, None)
    preferred_name = None
    for key in _NAME_KEYS:
        if key in props:
            preferred_name = props.pop(key)
            break
    formula = props.pop(_FORMULA_KEY, None)
    exact_mass_raw = props.pop(_EXACT_MASS_KEY, None)
    inchi = props.pop(_INCHI_KEY, None)
    mw_raw = props.pop(_MW_KEY, None)
    mw = float(mw_raw) if mw_raw not in (None, "") else None
    exact_mass = float(exact_mass_raw) if exact_mass_raw not in (None, "") else None
    display = {}
    for k, v in props.items():
        label = k[len("PUBCHEM_"):] if k.startswith("PUBCHEM_") else k
        display[label] = v
    return {
        "cid": cid,
        "smiles": smiles,
        "inchikey": inchikey,
        "molecular_weight": mw,
        "preferred_name": preferred_name,
        "formula": formula,
        "exact_mass": exact_mass,
        "inchi": inchi,
        "properties": display,
    }


def iter_sdf_records(stream, on_error: Optional[Callable[[Exception, Dict[str, Any]], None]] = None) -> Iterator[Dict[str, Any]]:
    buf = []
    for raw in stream:
        if raw.strip() == "$$$$":
            if buf:
                try:
                    yield _build_record(_parse_fields(buf))
                except Exception as exc:
                    log.warning("skip malformed SDF record: %s", exc)
                    if on_error is not None:
                        try:
                            on_error(exc, {"raw_lines": len(buf)})
                        except Exception:
                            log.exception("on_error callback failed")
                buf = []
            continue
        buf.append(raw)
    if buf and any(line.strip() for line in buf):
        try:
            yield _build_record(_parse_fields(buf))
        except Exception as exc:
            log.warning("skip malformed trailing SDF record: %s", exc)
