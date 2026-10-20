from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any


# Align demo mock invoices with a real row in the local SAP Excel exports so
# Summary & SAP can show invoice | SAP | result when AGENT_MODE=mock.
_DEMO_SAP_PO = {
    "po_number": "4500000002",
    "company_code": "MAH1",
    "supplier_id": "1000001001",
    "supplier_name": "Test Vendor 123",
    "currency": "INR",
    "total_amount": "1250.50",
    "invoice_date": "2025-03-15",
}


class MockTowerAgent:
    """Offline simulation only. It does not inspect document contents or use AI."""

    name = "TOWER"

    def run(self, file_path: str | Path, file_name: str) -> dict[str, Any]:
        name = Path(file_name).stem.lower().replace("-", "_").replace(" ", "_")
        if "credit" in name or "credit_note" in name:
            kind = "credit_note"
        elif "statement" in name:
            kind = "statement_of_account"
        elif "purchase_order" in name or name.startswith("po_"):
            kind = "purchase_order_list"
        elif "delivery" in name or "supporting" in name or "receipt" in name:
            kind = "supporting_document"
        else:
            kind = "invoice"
        return {
            "document_type": kind,
            "confidence": 0.82,
            "reason": "MOCK MODE: filename heuristic; verify the document manually.",
            "ai_parse_status": "mock",
            "mode": "mock",
        }


class MockLensAgent:
    """Offline simulation that populates unique demo fields for extractable docs.

    When SAP Excel exports are present, demo fields align to a known PO so
    source comparison can produce real invoice | SAP rows.
    """

    name = "LENS"
    EXTRACTABLE = {"invoice", "credit_note"}

    def run(self, file_path: str | Path, classification: dict[str, Any]) -> dict[str, Any]:
        kind = str(classification.get("document_type", "other")).lower()
        if kind not in self.EXTRACTABLE:
            return {
                "status": "skipped",
                "reason": f"MOCK MODE: extraction skipped for {kind}.",
                "raw_job": {},
                "converted": {
                    "classification_extraction": [],
                    "detailed_extraction": [],
                    "line_items": [],
                },
            }

        path = Path(file_path)
        stem = path.stem if path.name else "invoice"
        digest = hashlib.sha256(stem.encode("utf-8")).hexdigest()[:8].upper()
        # Prefer a stable invoice number derived from the filename when present.
        inv_match = re.search(r"(INV[-_]?\d[\w-]*)", stem, re.I)
        invoice_number = inv_match.group(1).upper() if inv_match else f"INV-MOCK-{digest}"

        header = {
            **_DEMO_SAP_PO,
            "invoice_number": invoice_number,
            "document_type": kind,
            "invoice_type": "standard",
        }

        def _entity(name: str, value: str) -> dict[str, Any]:
            return {
                "name": name,
                "type": "string",
                "stringValue": value,
                "rawValue": value,
                "confidence": 0.92,
            }

        return {
            "status": "completed",
            "reason": "MOCK MODE: demo fields populated for offline UI / comparison.",
            "raw_job": {"id": f"mock-{digest}", "status": "MOCK"},
            "converted": {
                "classification_extraction": [],
                "detailed_extraction": [
                    _entity(key, str(value)) for key, value in header.items()
                ],
                "line_items": [
                    {
                        "description": "Mock line item",
                        "quantity": "1",
                        "unit_price": header["total_amount"],
                        "amount": header["total_amount"],
                    }
                ],
                "extracted_header_fields": header,
            },
        }
