from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path
from typing import Any
from agents.review_policy import decide_review

from .config import AGENT_MODE, SAP_PROCESSING_ENABLED
from .database import audit, connect, json_dump, row_to_case, utc_now

from agents.orchestrator import APAgentOrchestrator


logger = logging.getLogger("ap_workflow")


def _set_status(
    case_id: str,
    status: str,
    *,
    reason: str,
    actor_id: str = "system",
    actor_role: str = "SYSTEM",
    extracted: dict[str, Any] | None = None,
    validation: dict[str, Any] | None = None,
) -> None:
    now = utc_now()
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM ap_cases WHERE id = ?", (case_id,)).fetchone()
        if row is None:
            conn.rollback()
            return
        before = {"status": row["status"], "version": row["version"]}
        fields = extracted or {}
        conn.execute(
            """UPDATE ap_cases SET status=?, review_reason=?,
            invoice_number=COALESCE(?, invoice_number), supplier_name=COALESCE(?, supplier_name),
            company_code=COALESCE(?, company_code), currency=COALESCE(?, currency),
            total_amount=COALESCE(?, total_amount), invoice_date=COALESCE(?, invoice_date),
            po_number=COALESCE(?, po_number), document_type=COALESCE(?, document_type), invoice_type=COALESCE(?, invoice_type),
            extracted_fields_json=?, line_items_json=?, validation_json=?, updated_at=?, version=version+1 WHERE id=?""",
            (
                status,
                reason,
                fields.get("invoice_number"),
                fields.get("supplier_name"),
                fields.get("company_code"),
                fields.get("currency"),
                str(fields.get("total_amount"))
                if fields.get("total_amount") is not None
                else None,
                fields.get("invoice_date"),
                fields.get("po_number"),
                fields.get("document_type"),
                fields.get("invoice_type"),
                json_dump(fields.get("extracted_header_fields", fields)),
                json_dump(fields.get("line_items", [])),
                json_dump(validation or {}),
                now,
                case_id,
            ),
        )
        audit(
            conn,
            event_id=str(uuid.uuid4()),
            case_id=case_id,
            event_type="PROCESSING_FINISHED"
            if status != "PROCESSING"
            else "PROCESSING_STARTED",
            actor_id=actor_id,
            actor_role=actor_role,
            reason=reason,
            before=before,
            after={"status": status},
            metadata={"processing_mode": "sap" if SAP_PROCESSING_ENABLED else "manual"},
        )
        if validation and validation.get("business_duplicate"):
            audit(
                conn,
                event_id=str(uuid.uuid4()),
                case_id=case_id,
                event_type="BUSINESS_DUPLICATE_SUSPECTED",
                actor_id="system",
                actor_role="SYSTEM",
                reason="A matching supplier invoice identity was found in an existing case.",
                after={"status": status, "duplicate_match": validation["business_duplicate"]},
                metadata={"decision_class": "RULE_RESULT"},
            )
        conn.commit()



def _find_business_duplicate(case_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    """Return a review signal for a matching supplier/invoice/company identity."""
    invoice_number = str(fields.get("invoice_number") or "").strip().casefold()
    company_code = str(fields.get("company_code") or "").strip().casefold()
    supplier_id = str(fields.get("supplier_id") or "").strip().casefold()
    supplier_name = str(fields.get("supplier_name") or "").strip().casefold()
    if not invoice_number or not company_code or not (supplier_id or supplier_name):
        return None
    if supplier_id:
        sql = """SELECT id, status, invoice_number, supplier_id, supplier_name, company_code, currency, total_amount
                 FROM ap_cases WHERE id <> ?
                 AND LOWER(TRIM(COALESCE(invoice_number, ''))) = ?
                 AND LOWER(TRIM(COALESCE(company_code, ''))) = ?
                 AND LOWER(TRIM(COALESCE(supplier_id, ''))) = ?
                 AND status <> 'REJECTED' ORDER BY created_at ASC LIMIT 1"""
        params = (case_id, invoice_number, company_code, supplier_id)
    else:
        sql = """SELECT id, status, invoice_number, supplier_id, supplier_name, company_code, currency, total_amount
                 FROM ap_cases WHERE id <> ?
                 AND LOWER(TRIM(COALESCE(invoice_number, ''))) = ?
                 AND LOWER(TRIM(COALESCE(company_code, ''))) = ?
                 AND LOWER(TRIM(COALESCE(supplier_name, ''))) = ?
                 AND status <> 'REJECTED' ORDER BY created_at ASC LIMIT 1"""
        params = (case_id, invoice_number, company_code, supplier_name)
    with connect() as conn:
        row = conn.execute(sql, params).fetchone()
    if row is None:
        return None
    return {
        "matched_case_id": row["id"], "matched_case_status": row["status"],
        "match_basis": "supplier_invoice_number_company_code",
        "invoice_number": row["invoice_number"], "supplier_id": row["supplier_id"],
        "supplier_name": row["supplier_name"], "company_code": row["company_code"],
        "currency": row["currency"], "total_amount": row["total_amount"],
    }


def _build_workflow_report(
    *,
    file_name: str,
    fields: dict,
    result: dict,
    classification: dict,
    extraction: dict,
    validation: dict,
    final_status: str,
) -> list[dict]:
    """Build an evidence-based workflow report for the case detail UI."""

    checks = validation.get("checks") or {}
    matching = validation.get("vector_matching") or {}
    missing_fields = (
        result.get("missing_fields")
        or validation.get("missing_fields")
        or []
    )
    review_decision = validation.get("review_decision") or {}
    document_type = (
        classification.get("document_type")
        or result.get("document_type")
        or "Unknown"
    )
    confidence = classification.get("confidence")
    po_status = str(
        matching.get("match_status")
        or checks.get("po")
        or "UNKNOWN"
    ).upper()

    def check_status(value):
        normalized = str(value or "not_checked").strip().lower()
        if normalized in {
            "passed", "pass", "valid", "clear", "no_duplicate"
        }:
            return "PASS"
        if normalized in {"failed", "fail", "invalid", "mismatch"}:
            return "WARN"
        return "WARN"

    # Step 1: File intake does not prove email ingestion occurred.
    steps = [{
        "key": "email_received",
        "title": "Email received",
        "service": "Document intake",
        "status": "INFO",
        "headline": "Document received by the AP intake workflow",
        "outcome": (
            "The case was processed from an uploaded document. "
            "Email ingestion is not verified by this workflow."
        ),
        "rules": [],
        "log": [f"File: {file_name}"],
        "lines": [],
    }]

    # Step 2: Classification
    classification_status = (
        "PASS" if document_type != "Unknown" else "WARN"
    )
    steps.append({
        "key": "document_classified",
        "title": "Document classified",
        "service": "TOWER / Classification",
        "status": classification_status,
        "headline": f"Document type: {document_type}",
        "outcome": (
            "A document type was returned by classification."
            if classification_status == "PASS"
            else "Classification did not return a known document type."
        ),
        "rules": [],
        "log": [
            f"Confidence: {confidence}"
            if confidence is not None
            else "Classification confidence not available."
        ],
        "lines": [],
    })

    # Step 3: Extraction
    extraction_failed = bool(extraction.get("error"))
    extraction_status = (
        "ERROR" if extraction_failed
        else "WARN" if missing_fields
        else "PASS"
    )
    steps.append({
        "key": "data_extracted",
        "title": "Data extracted",
        "service": "SAP Document AI / Extraction",
        "status": extraction_status,
        "headline": (
            "Extraction failed" if extraction_failed
            else f"{len(missing_fields)} required field(s) missing"
            if missing_fields
            else "Extraction returned no reported missing required fields"
        ),
        "outcome": (
            "Extraction reported an error."
            if extraction_failed
            else "Required fields need review."
            if missing_fields
            else "The triage result reports no missing required fields."
        ),
        "rules": [],
        "log": [
            f"Missing fields: {', '.join(map(str, missing_fields))}"
            if missing_fields
            else "No missing required fields reported by triage."
        ],
        "lines": [],
    })

    # Step 4: Approval gate
    manual_review = bool(review_decision.get("manual_review_required"))
    steps.append({
        "key": "approval_gate",
        "title": "Approval gate",
        "service": "AP Core / Review policy",
        "status": "WARN" if manual_review else "INFO",
        "headline": (
            "Manual review required"
            if manual_review
            else "Awaiting approval"
        ),
        "outcome": (
            "The case requires human review before proceeding."
            if manual_review
            else "Routing status is not proof of approval or SAP posting."
        ),
        "rules": [],
        "log": list(review_decision.get("reasons") or []),
        "lines": [],
    })

    # Step 5: Purchase order
    if po_status in {"PASS", "MATCH", "MATCHED"}:
        po_step_status = "PASS"
    elif po_status in {"FAIL", "MISMATCH", "FAILED"}:
        po_step_status = "WARN"
    else:
        po_step_status = "WARN"

    steps.append({
        "key": "purchase_order",
        "title": "Purchase order",
        "service": "VECTOR / PO matching",
        "status": po_step_status,
        "headline": f"PO match status: {po_status}",
        "outcome": (
            "PO matching returned a successful result."
            if po_step_status == "PASS"
            else "PO matching is failed, unknown, or not confirmed."
        ),
        "rules": [],
        "log": list(matching.get("reason_codes") or []),
        "lines": [],
    })

    # Step 6: Vendor
    vendor_value = checks.get("vendor", "not_checked")
    steps.append({
        "key": "vendor",
        "title": "Vendor",
        "service": "Vendor validation",
        "status": check_status(vendor_value),
        "headline": f"Vendor check: {vendor_value}",
        "outcome": (
            "Vendor check result recorded."
            if str(vendor_value).lower() != "not_checked"
            else "Independent vendor validation has not been confirmed."
        ),
        "rules": [],
        "log": [
            f"Supplier ID: {fields.get('supplier_id') or 'Not available'}"
        ],
        "lines": [],
    })

    # Step 7: Bank details
    steps.append({
        "key": "bank_details",
        "title": "Bank details",
        "service": "Bank verification",
        "status": "SKIP",
        "headline": "Bank verification not performed",
        "outcome": (
            "No bank-account verification result is available from the "
            "current workflow."
        ),
        "rules": [],
        "log": ["No verified bank validation integration result was supplied."],
        "lines": [],
    })

    # Step 8: Entity, payment path and department
    entity_fields = {
        key: fields.get(key)
        for key in (
            "company_code", "payment_method", "payment_terms",
            "department", "business_unit"
        )
        if fields.get(key) not in (None, "")
    }
    steps.append({
        "key": "entity_payment_department",
        "title": "Entity, payment path and department",
        "service": "Finance routing",
        "status": "INFO" if entity_fields else "WARN",
        "headline": (
            "Routing fields extracted"
            if entity_fields
            else "Routing fields not available"
        ),
        "outcome": (
            "Values are shown as extracted; their business validity "
            "has not been independently verified."
        ),
        "rules": [],
        "log": [
            f"{key}: {value}" for key, value in entity_fields.items()
        ] or ["No routing fields were available."],
        "lines": [],
    })

    # Step 9: Service entry sheets
    steps.append({
        "key": "service_entry_sheets",
        "title": "Service entry sheets",
        "service": "SES validation",
        "status": "SKIP",
        "headline": "SES validation not performed",
        "outcome": (
            "No service-entry-sheet validation result is available."
        ),
        "rules": [],
        "log": ["No SES validation result was supplied by the current workflow."],
        "lines": [],
    })

    # Step 10: G/L coding
    line_items = fields.get("line_items") or []
    gl_values_found = any(
        isinstance(item, dict)
        and any(item.get(key) not in (None, "") for key in (
            "gl_account", "gl_code", "cost_center"
        ))
        for item in line_items
    )
    steps.append({
        "key": "gl_coding",
        "title": "G/L coding",
        "service": "Finance coding validation",
        "status": "WARN",
        "headline": (
            "Coding values present but not validated"
            if gl_values_found
            else "G/L coding validation not performed"
        ),
        "outcome": (
            "Extracted coding values are not proof of valid SAP account "
            "assignment."
        ),
        "rules": [],
        "log": [
            "Line items: " + str(len(line_items)),
            "No validated G/L coding result was supplied.",
        ],
        "lines": [],
    })

    # Step 11: Final workflow result
    if final_status == "PROCESSING_ERROR":
        final_step_status = "ERROR"
    elif final_status == "NEEDS_REVIEW":
        final_step_status = "WARN"
    else:
        final_step_status = "INFO"

    steps.append({
        "key": "final_result",
        "title": "Final result",
        "service": "AP Core",
        "status": final_step_status,
        "headline": final_status,
        "outcome": (
            "Processing failed; inspect server logs."
            if final_status == "PROCESSING_ERROR"
            else "Human review is required before further processing."
            if final_status == "NEEDS_REVIEW"
            else "The case is routed for approval; it has not been approved "
                 "or posted to SAP."
        ),
        "rules": [],
        "log": [
            f"Case status: {final_status}",
            f"Agent mode: {validation.get('agent_mode', 'unknown')}",
        ],
        "lines": [],
    })

    return steps


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
        _set_status(
            case_id,
            "NEEDS_REVIEW",
            reason="Agent processing is disabled. Review the uploaded document and enter/verify the extracted fields.",
            validation={
                "blocking": ["AGENT_PROCESSING_DISABLED"],
                "checks": {
                    "vendor": "not_checked",
                    "po": "not_checked",
                    "tax": "not_checked",
                    "duplicate": "not_checked",
                },
                "agent_trace": [],
            },
        )
        return

    try:
        from agents.orchestrator import APAgentOrchestrator



        from agents.orchestrator import APAgentOrchestrator

        extended_context = None


        if AGENT_MODE == "mock":
            from agents.mock_agents import MockLensAgent, MockTowerAgent

            orchestrator = APAgentOrchestrator(
                tower=MockTowerAgent(),
                lens=MockLensAgent(),
            )
            extended_context = None

        elif AGENT_MODE == "sap":
            from agents.vector import VectorMatchingAgent
            from integrations.excel_sap_reader import ExcelSAPReadOnlyReader

            excel_reader = ExcelSAPReadOnlyReader()
            orchestrator = APAgentOrchestrator(
                vector=VectorMatchingAgent(sap_reader=excel_reader)
            )
            extended_context = {}

        else:
            orchestrator = APAgentOrchestrator()
            extended_context = None

        agent_result = orchestrator.run(
            row["stored_path"],
            row["file_name"],
            extended_context=extended_context,
        )

        result = agent_result.triage
        classification = agent_result.classification
        extraction = agent_result.extraction
        raw_dox = extraction.get("raw_job", {})
        fields = dict(result.get("extracted_header_fields", {}))
        fields["extracted_header_fields"] = result.get("extracted_header_fields", {})
        fields["line_items"] = result.get("line_items", [])
        fields["document_type"] = result.get("document_type")
        fields["invoice_type"] = result.get("invoice_type")

        validation = dict(agent_result.validation)
        validation["agent_mode"] = AGENT_MODE

        if AGENT_MODE == "mock":
            validation.setdefault("blocking", []).append(
                "MOCK_AGENT_MODE_NOT_FOR_PRODUCTION"
            )

        # Read the actual outputs from classification and finance triage.
        checks = validation.get("checks") or {}
        missing_fields = (
            result.get("missing_fields") or validation.get("missing_fields") or []
        )

        # Only explicitly successful checks count as passed.
        duplicate_status = str(checks.get("duplicate", "not_checked")).strip().lower()

        duplicate_check_passed = duplicate_status in {
            "passed",
            "pass",
            "clear",
            "no_duplicate",
        }

        # The current orchestrator does not expose field-level confidence
        # scores. Keep this False until those scores are implemented.
        critical_fields_confident = False

        # Do not assume unimplemented vendor, PO, or tax checks succeeded.
        required_checks = ("vendor", "po", "tax", "duplicate")
        business_checks_passed = all(
            str(checks.get(name, "not_checked")).strip().lower()
            in {"passed", "pass", "valid", "clear", "no_duplicate"}
            for name in required_checks
        )

        validation_passed = (
            not validation.get("blocking")
            and not result.get("review_required", False)
            and business_checks_passed
        )

        review_decision = decide_review(
            classification=classification.get("document_type"),
            confidence=classification.get("confidence"),
            validation_passed=validation_passed,
            required_fields_complete=not bool(missing_fields),
            critical_fields_confident=critical_fields_confident,
            duplicate_check_passed=duplicate_check_passed,
        )

        # Persist the decision so the UI and reviewers can explain the route.
        validation["review_decision"] = review_decision.to_dict()

        business_duplicate = _find_business_duplicate(case_id, fields)
        if business_duplicate:
            validation["business_duplicate"] = business_duplicate
            validation["checks"] = dict(validation.get("checks") or {})
            validation["checks"]["duplicate"] = "suspected_duplicate"

        reason = result.get("review_reason") or (
            "Classification and extraction completed. "
            "Review the extracted fields and complete finance checks."
        )

        if business_duplicate:
            status = "NEEDS_REVIEW"
            reason = (
                "Possible business duplicate: this supplier, invoice number, "
                "and company code already exist in another case. Compare both records."
            )
        elif review_decision.manual_review_required:
            status = "NEEDS_REVIEW"
            reason = "Manual review required: " + "; ".join(review_decision.reasons)
        else:
            # This is a routing state only, not an approval or SAP posting.
            status = "READY_FOR_APPROVAL"
            reason = "Automatic eligibility checks passed; awaiting approval."

        validation["workflow_report"] = _build_workflow_report(
            file_name=row["file_name"],
            fields=fields,
            result=result,
            classification=classification,
            extraction=extraction,
            validation=validation,
            final_status=status,
        )


        _set_status(
            case_id,
            status,
            reason=reason,
            extracted=fields,
            validation=validation,
        )

    except Exception as exc:
        logger.exception("SAP processing failed for case %s", case_id)
        _set_status(
            case_id,
            "PROCESSING_ERROR",
            reason=f"Processing failed: {type(exc).__name__}. Check server logs.",
            validation={
                "blocking": ["PROCESSING_ERROR"],
                "error_type": type(exc).__name__,
            },
        )
