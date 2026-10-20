"""Attach invoice-vs-SAP comparison rows to case validation.

Uses the Excel SAP export readers ported from backend-abdulahad when available.
Falls back to a clear field-level synthesis so Summary always has useful rows
after a successful extraction.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("ap_workflow")

COMPARE_FIELDS = (
    ("po_number", "Purchase order"),
    ("supplier_name", "Supplier"),
    ("supplier_id", "Supplier ID"),
    ("company_code", "Company code"),
    ("currency", "Currency"),
    ("total_amount", "Total amount"),
    ("invoice_date", "Invoice date"),
    ("invoice_number", "Invoice number"),
)


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def invoice_payload_from_fields(fields: dict[str, Any]) -> dict[str, Any]:
    header = fields.get("extracted_header_fields")
    if isinstance(header, dict) and header:
        base = dict(header)
    else:
        base = dict(fields)
    return {
        "invoice_number": _text(base.get("invoice_number") or fields.get("invoice_number")),
        "supplier_name": _text(base.get("supplier_name") or fields.get("supplier_name")),
        "supplier_id": _text(base.get("supplier_id") or fields.get("supplier_id")),
        "company_code": _text(base.get("company_code") or fields.get("company_code")),
        "currency": _text(base.get("currency") or fields.get("currency")).upper(),
        "total_amount": _text(base.get("total_amount") or fields.get("total_amount")),
        "invoice_date": _text(base.get("invoice_date") or fields.get("invoice_date")),
        "po_number": _text(base.get("po_number") or fields.get("po_number")),
    }


def synthesize_field_comparisons(invoice: dict[str, Any]) -> list[dict[str, Any]]:
    """Build invoice | reference | result rows from extracted fields alone."""
    rows: list[dict[str, Any]] = []
    for key, label in COMPARE_FIELDS:
        value = _text(invoice.get(key))
        if not value:
            continue
        rows.append(
            {
                "check": key,
                "field": key,
                "label": label,
                "invoice": value,
                "sap": "—",
                "result": "NOT_COMPARED",
                "status": "NOT_COMPARED",
                "message": "No SAP reference row for this field yet.",
            }
        )
    return rows


def run_source_verdict(fields: dict[str, Any]) -> dict[str, Any] | None:
    """Run Excel SAP source check when exports are present; otherwise None."""
    invoice = invoice_payload_from_fields(fields)
    if not any(invoice.values()):
        return None
    try:
        from agents.source_check import SourceCheckAgent
        from agents.verifier import VerifierMatchingAgent
        from integrations.excel_sap_finance_reader import ExcelSAPFinanceReader
        from integrations.excel_sap_reader import ExcelSAPReadOnlyReader

        po_reader = ExcelSAPReadOnlyReader()
        finance_reader = ExcelSAPFinanceReader()
        source = SourceCheckAgent(po_reader, finance_reader)
        verdict = source.run(invoice)
        verifier = VerifierMatchingAgent(sap_reader=po_reader)
        matching = verifier.run(invoice)
        return {
            "source_verdict": verdict,
            "source_checks": list(verdict.get("comparisons") or []),
            "verifier_matching": matching,
        }
    except FileNotFoundError as exc:
        logger.info("SAP Excel exports unavailable for comparison: %s", exc)
        return None
    except Exception:
        logger.exception("SAP source comparison failed; using field synthesis")
        return None


def attach_comparison(fields: dict[str, Any], validation: dict[str, Any]) -> dict[str, Any]:
    """Mutate and return validation with source_verdict / synthesized rows."""
    out = dict(validation or {})
    if out.get("source_verdict") and out.get("source_verdict", {}).get("comparisons"):
        return out

    sap_bundle = run_source_verdict(fields)
    if sap_bundle:
        out.update(sap_bundle)
        return out

    invoice = invoice_payload_from_fields(fields)
    rows = synthesize_field_comparisons(invoice)
    if not rows:
        return out

    out["source_verdict"] = {
        "agent": "SYNTHETIC_FIELD_COMPARE",
        "status": "NOT_COMPARED",
        "summary": (
            "Extracted fields are shown for review. SAP Excel reference data was "
            "not available to produce a live match."
        ),
        "comparisons": rows,
        "discrepancies": [],
    }
    out["source_checks"] = rows
    return out
