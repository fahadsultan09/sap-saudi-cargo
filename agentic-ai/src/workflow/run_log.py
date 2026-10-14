"""Run logging: console + output/run.log, and CSV tables you can open in Excel.

    output/run_log.csv     one row per attachment (appended across runs)
    output/dox_fields.csv  one row per Document AI field with its confidence
    output/dox_raw/*.json  the raw Document AI response for every extraction

CSVs are UTF-8 with BOM so Excel opens them without mojibake.
"""

from __future__ import annotations

import csv
import json
import logging
import re
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from triage.config import OUTPUT_DIR

COLUMNS = [
    "run_id", "timestamp", "email_id", "subject", "sender", "received",
    "attachment_name", "attachment_size", "saved_path", "status",
    "ai_document_type", "ai_confidence", "ai_reason", "ai_parse_status",
    "dox_job_id", "dox_status", "dox_raw_path",
    "invoice_number", "invoice_date", "supplier_name", "po_number",
    "total_amount", "currency",
    "triage_document_type", "invoice_type",
    "triage_confidence", "review_required", "review_reason", "missing_fields",
    "error", "duration_s",
]

FIELD_COLUMNS = ["run_id", "attachment_name", "dox_job_id", "scope", "field", "value", "confidence"]

CSV_PATH = OUTPUT_DIR / "run_log.csv"
FIELDS_PATH = OUTPUT_DIR / "dox_fields.csv"
DOX_RAW_DIR = OUTPUT_DIR / "dox_raw"


def setup_logging() -> None:
    """Console + file logging, UTF-8 safe on Windows. Call once at startup."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler(OUTPUT_DIR / "run.log", encoding="utf-8"),
        ],
        force=True,
    )
    # httpx logs full request URLs (the Graph proxy fallback puts the token in the URL)
    logging.getLogger("httpx").setLevel(logging.WARNING)


_SIDE_FILES: dict[Path, Path] = {}


def _append_csv(path: Path, columns: list[str], rows: list[dict[str, Any]]) -> None:
    """Append rows to a CSV, writing the header for a new file.

    If the file has an older header it is renamed (not overwritten), and if it is
    locked (open in Excel) the rows go to a side file instead of being lost.
    """
    alt = _SIDE_FILES.get(path)
    if alt is None:
        try:
            _write_rows(path, columns, rows)
            return
        except PermissionError:
            # One side file per locked CSV for the whole process, so a run's rows stay together
            alt = path.with_name(f"{path.stem}_{datetime.now():%Y%m%d_%H%M%S}{path.suffix}")
            _SIDE_FILES[path] = alt
            logging.getLogger("workflow").warning("%s is locked; writing to %s", path, alt)
    _write_rows(alt, columns, rows)


def _write_rows(path: Path, columns: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size:
        with open(path, encoding="utf-8-sig") as fh:
            old_header = fh.readline().strip().split(",")
        if old_header != columns:
            path.rename(path.with_name(f"{path.stem}_old_{datetime.now():%Y%m%d_%H%M%S}{path.suffix}"))
    is_new = not path.exists()
    with open(path, "a", newline="", encoding="utf-8-sig" if is_new else "utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns)
        if is_new:
            writer.writeheader()
        writer.writerows(rows)


class RunLog:
    """Appends one CSV row per processed attachment."""

    def __init__(self, path: Path = CSV_PATH) -> None:
        self.path = path
        self.run_id = uuid.uuid4().hex[:8]

    def add(self, **fields: Any) -> None:
        row = {c: "" for c in COLUMNS}
        row["run_id"] = self.run_id
        row["timestamp"] = datetime.now().isoformat(timespec="seconds")
        row.update({k: v for k, v in fields.items() if k in row})
        _append_csv(self.path, COLUMNS, [row])


def save_dox_raw(extraction: dict[str, Any], attachment_name: str, message_id: str = "") -> str:
    """Save the raw Document AI response (every field with its confidence)."""
    DOX_RAW_DIR.mkdir(parents=True, exist_ok=True)
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", f"{message_id[-8:]}_{attachment_name}").strip("_")
    path = DOX_RAW_DIR / f"{name}.json"
    path.write_text(json.dumps(extraction, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    return str(path)


def append_dox_fields(run_id: str, attachment_name: str, extraction: dict[str, Any],
                      path: Path = FIELDS_PATH) -> None:
    """One row per Document AI header / line-item field: value and confidence."""
    job_id = extraction.get("id", "")
    ex = extraction.get("extraction") or {}
    rows = []

    def add(scope: str, field: dict[str, Any]) -> None:
        rows.append({
            "run_id": run_id, "attachment_name": attachment_name, "dox_job_id": job_id,
            "scope": scope, "field": field.get("name", ""),
            "value": field.get("value", ""), "confidence": field.get("confidence", ""),
        })

    for f in ex.get("headerFields") or []:
        add("header", f)
    for i, item in enumerate(ex.get("lineItems") or [], 1):
        for f in (item if isinstance(item, list) else []):
            add(f"line {i}", f)
    if rows:
        _append_csv(path, FIELD_COLUMNS, rows)


def row_from_result(result: dict[str, Any]) -> dict[str, Any]:
    """Pull the CSV fields out of a triage result dict."""
    h = result.get("extracted_header_fields") or {}
    ai = result.get("ai_core_classification") or {}
    dox = result.get("sap_doc_ai") or {}
    return {
        "ai_document_type": ai.get("document_type"),
        "ai_confidence": ai.get("confidence"),
        "ai_reason": ai.get("reason"),
        "ai_parse_status": ai.get("ai_parse_status"),
        "dox_job_id": dox.get("job_id"),
        "dox_status": dox.get("status"),
        "dox_raw_path": dox.get("raw_path"),
        "invoice_number": h.get("invoice_number"),
        "invoice_date": h.get("invoice_date"),
        "supplier_name": h.get("supplier_name"),
        "po_number": h.get("po_number"),
        "total_amount": h.get("total_amount"),
        "currency": h.get("currency"),
        "triage_document_type": result.get("document_type"),
        "invoice_type": result.get("invoice_type"),
        "triage_confidence": round(result.get("confidence") or 0.0, 3),
        "review_required": result.get("review_required"),
        "review_reason": result.get("review_reason"),
        "missing_fields": ", ".join(result.get("missing_fields") or []),
    }
