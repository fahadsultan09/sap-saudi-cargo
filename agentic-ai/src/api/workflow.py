from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path
from typing import Any

from .config import AGENT_MODE, SAP_PROCESSING_ENABLED
from .database import audit, connect, json_dump, row_to_case, utc_now

logger = logging.getLogger("ap_workflow")


def _set_status(case_id: str, status: str, *, reason: str, actor_id: str = "system", actor_role: str = "SYSTEM",
                extracted: dict[str, Any] | None = None, validation: dict[str, Any] | None = None) -> None:
    now = utc_now()
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM ap_cases WHERE id = ?", (case_id,)).fetchone()
        if row is None:
            conn.rollback()
            return
        before = {"status": row["status"], "version": row["version"]}
        fields = extracted or {}
        conn.execute("""UPDATE ap_cases SET status=?, review_reason=?,
            invoice_number=COALESCE(?, invoice_number), supplier_name=COALESCE(?, supplier_name),
            company_code=COALESCE(?, company_code), currency=COALESCE(?, currency),
            total_amount=COALESCE(?, total_amount), invoice_date=COALESCE(?, invoice_date),
            po_number=COALESCE(?, po_number), document_type=COALESCE(?, document_type), invoice_type=COALESCE(?, invoice_type),
            extracted_fields_json=?, line_items_json=?, validation_json=?, updated_at=?, version=version+1 WHERE id=?""",
            (status, reason, fields.get("invoice_number"), fields.get("supplier_name"), fields.get("company_code"),
             fields.get("currency"), str(fields.get("total_amount")) if fields.get("total_amount") is not None else None,
             fields.get("invoice_date"), fields.get("po_number"), fields.get("document_type"), fields.get("invoice_type"),
             json_dump(fields.get("extracted_header_fields", fields)), json_dump(fields.get("line_items", [])),
             json_dump(validation or {}), now, case_id))
        audit(conn, event_id=str(uuid.uuid4()), case_id=case_id, event_type="PROCESSING_FINISHED" if status != "PROCESSING" else "PROCESSING_STARTED",
              actor_id=actor_id, actor_role=actor_role, reason=reason, before=before,
              after={"status": status}, metadata={"processing_mode": "sap" if SAP_PROCESSING_ENABLED else "manual"})
        conn.commit()


def process_case(case_id: str) -> None:
    """Run existing AI Core -> Document AI -> triage modules for an uploaded case.

    External processing is opt-in. With it disabled, the case remains visible in
    manual review rather than being falsely marked as validated or approved.
    """
    with connect() as conn:
        row = conn.execute("SELECT * FROM ap_cases WHERE id = ?", (case_id,)).fetchone()
    if row is None:
        return
    _set_status(case_id, "PROCESSING", reason="Invoice processing started")
    if AGENT_MODE == "disabled":
        _set_status(case_id, "NEEDS_REVIEW", reason="Agent processing is disabled. Review the uploaded document and enter/verify the extracted fields.",
                    validation={"blocking": ["AGENT_PROCESSING_DISABLED"], "checks": {"vendor": "not_checked", "po": "not_checked", "tax": "not_checked", "duplicate": "not_checked"},
                                "agent_trace": []})
        return

    try:
        from agents.orchestrator import APAgentOrchestrator

        if AGENT_MODE == "mock":
            from agents.mock_agents import MockLensAgent, MockTowerAgent
            orchestrator = APAgentOrchestrator(tower=MockTowerAgent(), lens=MockLensAgent())
        else:
            orchestrator = APAgentOrchestrator()
        agent_result = orchestrator.run(row["stored_path"], row["file_name"])
        result = agent_result.triage
        classification = agent_result.classification
        extraction = agent_result.extraction
        raw_dox = extraction.get("raw_job", {})
        fields = dict(result.get("extracted_header_fields", {}))
        fields["extracted_header_fields"] = result.get("extracted_header_fields", {})
        fields["line_items"] = result.get("line_items", [])
        fields["document_type"] = result.get("document_type")
        fields["invoice_type"] = result.get("invoice_type")
        validation = agent_result.validation
        validation["agent_mode"] = AGENT_MODE
        if AGENT_MODE == "mock":
            validation.setdefault("blocking", []).append("MOCK_AGENT_MODE_NOT_FOR_PRODUCTION")
        reason = result.get("review_reason") or (
            "Classification and extraction completed. Vendor, PO, tax and duplicate checks "
            "still require trusted business-data integration or explicit review."
        )
        _set_status(case_id, "NEEDS_REVIEW", reason=reason, extracted=fields, validation=validation)
    except Exception as exc:
        logger.exception("SAP processing failed for case %s", case_id)
        _set_status(case_id, "PROCESSING_ERROR", reason=f"Processing failed: {type(exc).__name__}. Check server logs.",
                    validation={"blocking": ["PROCESSING_ERROR"], "error_type": type(exc).__name__})
