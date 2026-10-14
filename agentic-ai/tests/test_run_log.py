"""Tests for the CSV run log."""

import csv

from workflow.run_log import COLUMNS, RunLog


def test_header_once_and_rows_appended(tmp_path):
    path = tmp_path / "run_log.csv"
    log = RunLog(path)
    log.add(subject="a", status="processed", ai_document_type="invoice")
    log.add(subject="b", status="skipped", error="no attachments")

    assert path.read_bytes().startswith(b"\xef\xbb\xbf")  # BOM so Excel reads UTF-8
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    assert list(rows[0].keys()) == COLUMNS
    assert [r["subject"] for r in rows] == ["a", "b"]
    assert rows[0]["ai_document_type"] == "invoice"


def test_unicode_survives(tmp_path):
    path = tmp_path / "run_log.csv"
    RunLog(path).add(subject="فاتورة — tax invoice")
    with open(path, newline="", encoding="utf-8-sig") as fh:
        assert next(csv.DictReader(fh))["subject"] == "فاتورة — tax invoice"


def test_dox_fields_table_has_confidence(tmp_path):
    from workflow.run_log import append_dox_fields

    extraction = {"id": "job-1", "extraction": {
        "headerFields": [{"name": "documentNumber", "value": "INV1", "confidence": 0.91}],
        "lineItems": [[{"name": "description", "value": "Fuel", "confidence": 0.8}]],
    }}
    path = tmp_path / "dox_fields.csv"
    append_dox_fields("r1", "a.pdf", extraction, path)
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    assert [(r["scope"], r["field"], r["confidence"]) for r in rows] == [
        ("header", "documentNumber", "0.91"), ("line 1", "description", "0.8")]


def test_old_header_is_rotated_not_mixed(tmp_path):
    path = tmp_path / "run_log.csv"
    path.write_text("old_a,old_b\n1,2\n", encoding="utf-8")
    RunLog(path).add(subject="x")
    assert len(list(tmp_path.glob("run_log_old_*.csv"))) == 1
    with open(path, newline="", encoding="utf-8-sig") as fh:
        assert list(csv.DictReader(fh))[0]["subject"] == "x"
