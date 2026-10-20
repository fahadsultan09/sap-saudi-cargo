from __future__ import annotations

from pathlib import Path
from typing import Any


class MockClassifierAgent:
    """Offline simulation only. It does not inspect document contents or use AI."""
    name = "CLASSIFIER"

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
        return {"document_type": kind, "confidence": 0.35,
                "reason": "MOCK MODE: filename heuristic only; verify the document manually.",
                "ai_parse_status": "mock", "mode": "mock"}


class MockScannerAgent:
    """Offline simulation only. Returns no fabricated invoice field values."""
    name = "SCANNER"
    EXTRACTABLE = {"invoice", "credit_note"}

    def run(self, file_path: str | Path, classification: dict[str, Any]) -> dict[str, Any]:
        kind = str(classification.get("document_type", "other")).lower()
        if kind not in self.EXTRACTABLE:
            return {"status": "skipped", "reason": f"MOCK MODE: extraction skipped for {kind}.",
                    "raw_job": {}, "converted": {"classification_extraction": [], "detailed_extraction": [], "line_items": []}}
        return {"status": "completed", "reason": "MOCK MODE: extraction adapter exercised, no values fabricated.",
                "raw_job": {"id": None, "status": "MOCK"},
                "converted": {"classification_extraction": [], "detailed_extraction": [], "line_items": []}}
