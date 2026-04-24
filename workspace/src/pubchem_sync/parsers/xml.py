"""Streaming XML parser for PubChem PC-Compound documents.

Uses xml.etree.ElementTree.iterparse so memory stays bounded.
Elements are cleared after processing.
"""
from __future__ import annotations
import logging
import xml.etree.ElementTree as ET
from typing import Iterator, Dict, Any, Optional, Callable

log = logging.getLogger(__name__)

_LABEL_MAP = {
    "SMILES": "smiles",
    "InChIKey": "inchikey",
    "Molecular Weight": "molecular_weight",
    "Molecular Formula": "formula",
    "Exact Mass": "exact_mass",
    "IUPAC Name": "preferred_name",
    "InChI": "inchi",
}


def _local(tag):
    return tag.split("}", 1)[-1]


def _extract_compound(elem):
    rec = {"cid": None, "smiles": None, "inchikey": None, "molecular_weight": None, "preferred_name": None, "formula": None, "exact_mass": None, "inchi": None, "properties": {}}
    for node in elem.iter():
        tag = _local(node.tag)
        if tag == "PC-CompoundType_id_cid" and node.text:
            try:
                rec["cid"] = int(node.text.strip())
            except ValueError:
                pass
        elif tag == "PC-InfoData":
            label = None
            value = None
            for sub in node.iter():
                st = _local(sub.tag)
                if st == "PC-Urn_label" and sub.text:
                    label = sub.text.strip()
                elif st == "PC-InfoData_value_sval" and sub.text is not None:
                    value = sub.text.strip()
                elif st == "PC-InfoData_value_fval" and sub.text is not None:
                    try:
                        value = float(sub.text.strip())
                    except ValueError:
                        value = sub.text.strip()
                elif st == "PC-InfoData_value_ival" and sub.text is not None:
                    try:
                        value = int(sub.text.strip())
                    except ValueError:
                        value = sub.text.strip()
            if label is None:
                continue
            mapped = _LABEL_MAP.get(label)
            if mapped in {"molecular_weight", "exact_mass"} and value is not None:
                try:
                    rec[mapped] = float(value)
                except (TypeError, ValueError):
                    pass
            elif mapped:
                rec[mapped] = value
            else:
                rec["properties"][label] = value
    if rec["cid"] is None:
        raise ValueError("PC-Compound missing CID")
    return rec


def iter_xml_compounds(path: str, on_error: Optional[Callable[[Exception, Dict[str, Any]], None]] = None) -> Iterator[Dict[str, Any]]:
    try:
        ctx = ET.iterparse(path, events=("end",))
        for _event, elem in ctx:
            if _local(elem.tag) == "PC-Compound":
                try:
                    yield _extract_compound(elem)
                except Exception as exc:
                    log.warning("skip malformed PC-Compound: %s", exc)
                    if on_error is not None:
                        on_error(exc, {})
                finally:
                    elem.clear()
    except ET.ParseError as exc:
        log.warning("xml parse failed: %s", exc)
        if on_error is not None:
            try:
                on_error(exc, {"path": path})
            except Exception:
                log.exception("on_error failed")
