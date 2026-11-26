"""Read-only presentation snapshots; AP Core still decides the final invoice route."""
from typing import Any


def progress_snapshot(classification: dict, extraction: dict, triage: dict, matching: dict,
                      source_verdict: dict, investigation: dict) -> dict[str, Any]:
    converted = extraction.get("converted") or {}
    invoice = converted.get("invoice_source") or {}
    fields = dict(invoice)
    fields["supplier_id"] = invoice.get("vendor_number") or invoice.get("supplier_id")
    fields["document_type"] = classification.get("document_type")
    fields["line_items"] = converted.get("line_items", [])
    fields["field_locations"] = converted.get("field_locations", {})
    if not fields.get("company_code"):
        fields["company_code"] = next((row.get("sap") for row in source_verdict.get("comparisons", [])
                                       if row.get("check") == "company_code" and row.get("result") == "NOT_ON_INVOICE"), None)
    validation: dict[str, Any] = {}
    if classification:
        validation["ai_core"] = classification
    if extraction:
        validation.update(document_ai_status=extraction.get("raw_job", {}).get("status"),
                          document_ai_job_id=extraction.get("raw_job", {}).get("id"))
    if triage:
        validation.update(confidence=triage.get("confidence"), missing_fields=triage.get("missing_fields", []),
                          finance_rules=triage.get("finance_rules", []), triage_review_reason=triage.get("review_reason"),
                          blocking=["TRIAGE_REVIEW_REQUIRED"] if triage.get("review_required") else [])
    if matching:
        validation["verifier_matching"] = matching
    if source_verdict:
        validation["source_verdict"] = source_verdict
    if investigation:
        validation["investigation"] = investigation
    return {"type": "data", "fields": fields, "validation": validation}
