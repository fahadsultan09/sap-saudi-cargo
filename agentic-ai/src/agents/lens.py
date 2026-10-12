from __future__ import annotations

from pathlib import Path
from typing import Any


class LensExtractionAgent:
    """LENS: delegates invoice field extraction to SAP Document AI (DOX)."""
    name = "LENS"
    EXTRACTABLE = {"invoice", "credit_note"}

    def __init__(self, client: Any | None = None):
        self._client = client

    def run(self, file_path: str | Path, classification: dict[str, Any]) -> dict[str, Any]:
        kind = str(classification.get("document_type", "other")).lower()
        if kind not in self.EXTRACTABLE:
            return {
                "status": "skipped",
                "reason": f"TOWER classified document as {kind}; LENS only processes invoices and credit notes.",
                "raw_job": {},
                "converted": {"classification_extraction": [], "detailed_extraction": [], "line_items": []},
            }
        if self._client is None:
            from triage.doc_ai import DocAIClient
            client = DocAIClient()
        else:
            client = self._client
        raw_job = client.upload_and_process(file_path=str(file_path))
        converted = client.convert_results(raw_job)
        return {
            "status": "completed",
            "reason": "SAP Document AI extraction completed.",
            "raw_job": {"id": raw_job.get("id"), "status": raw_job.get("status")},
            "converted": converted,
        }
