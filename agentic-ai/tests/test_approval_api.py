from __future__ import annotations

import os
import uuid
from pathlib import Path

# Isolate the API database before importing the application module.
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("AUTH_MODE", "dev")
os.environ["AP_DATA_DIR"] = str(Path("/tmp") / f"sacc-api-tests-{uuid.uuid4().hex}")
os.environ["SAP_PROCESSING_ENABLED"] = "false"
os.environ["AGENT_MODE"] = "mock"

from fastapi.testclient import TestClient
from api.main import app


def headers(user: str, role: str) -> dict[str, str]:
    return {"X-User-Id": user, "X-User-Role": role}

def test_upload_review_submit_and_approve():
    with TestClient(app) as client:
        pdf = b"%PDF-1.4\n% mock test document\n%%EOF"

        upload = client.post(
            "/api/v1/cases/upload",
            headers=headers("processor-1", "AP_PROCESSOR"),
            files={"file": ("invoice.pdf", pdf, "application/pdf")},
        )
        assert upload.status_code == 202, upload.text
        case_id = upload.json()["case_id"]

        detail = client.get(
            f"/api/v1/cases/{case_id}",
            headers=headers("processor-1", "AP_PROCESSOR"),
        )
        assert detail.status_code == 200
        assert detail.json()["status"] == "NEEDS_REVIEW"

        correction = client.patch(
            f"/api/v1/cases/{case_id}/fields",
            headers=headers("processor-1", "AP_PROCESSOR"),
            json={
                "fields": {
                    "invoice_number": "INV-1001",
                    "supplier_name": "Example Supplier",
                    "currency": "SAR",
                    "total_amount": "1250.50",
                    "invoice_date": "2026-10-12",
                },
                "comment": "Verified against the uploaded invoice",
            },
        )
        assert correction.status_code == 200, correction.text

        # The preparer must not approve their own invoice.
        self_approve = client.post(
            f"/api/v1/cases/{case_id}/approve",
            headers=headers("processor-1", "AP_APPROVER"),
            json={"comment": "I approve"},
        )
        assert self_approve.status_code == 403

        # An authorized approver makes the decision directly from NEEDS_REVIEW.
        approve = client.post(
            f"/api/v1/cases/{case_id}/approve",
            headers=headers("approver-1", "AP_APPROVER"),
            json={"comment": "Reviewed and approved under POC policy"},
        )
        assert approve.status_code == 200, approve.text
        assert approve.json()["status"] == "APPROVED"
        assert "not enabled" in approve.json()["message"].lower()

        # Verify the final case status.
        detail_after = client.get(
            f"/api/v1/cases/{case_id}",
            headers=headers("approver-1", "AP_APPROVER"),
        )
        assert detail_after.status_code == 200
        assert detail_after.json()["status"] == "APPROVED"

        # Verify the audit history reflects a direct decision.
        history = client.get(
            f"/api/v1/cases/{case_id}/history",
            headers=headers("approver-1", "AP_APPROVER"),
        )
        assert history.status_code == 200

        event_types = [
            event["event_type"] for event in history.json()["events"]
        ]
        assert "CASE_UPLOADED" in event_types
        assert "FIELDS_CORRECTED" in event_types
        assert "APPROVAL_APPROVED" in event_types
        assert "APPROVAL_REQUESTED" not in event_types

        # The decision must no longer require an approval request.
        assert len(history.json()["decisions"]) >= 1
        assert history.json()["decisions"][-1]["approval_request_id"] is None


def test_upload_rejects_unsupported_type():
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/cases/upload",
            headers=headers("processor-1", "AP_PROCESSOR"),
            files={"file": ("invoice.exe", b"MZ", "application/octet-stream")},
        )
        assert response.status_code == 415


def test_role_is_required():
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/approvals", headers=headers("processor-1", "AP_PROCESSOR")
        )
        assert response.status_code == 403


def test_agents_route_describes_minimum_architecture():
    with TestClient(app) as client:
        response = client.get("/api/v1/agents", headers=headers("admin-1", "ADMIN"))
        assert response.status_code == 200
        data = response.json()
        assert data["execution_order"] == ["EMAIL_INTAKE", "TOWER", "LENS", "FINANCE_RULES", "VECTOR", "SOURCE_CHECK", "PRISM", "PLUMB"]
        statuses = {agent["name"]: agent["status"] for agent in data["agents"]}
        assert statuses["VECTOR"] == "implemented_requires_sap_context"
        assert statuses["PRISM"] == "implemented_requires_evidence"
        assert statuses["PLUMB"] == "implemented_requires_payment_data"



def test_exact_duplicate_upload_returns_existing_case_without_new_case():
    with TestClient(app) as client:
        pdf = b"%PDF-1.4\\n% identical invoice for duplicate test\\n%%EOF"
        h = headers("processor-duplicate", "AP_PROCESSOR")

        first = client.post(
            "/api/v1/cases/upload",
            headers=h,
            files={"file": ("invoice.pdf", pdf, "application/pdf")},
        )
        assert first.status_code == 202, first.text
        first_case_id = first.json()["case_id"]

        second = client.post(
            "/api/v1/cases/upload",
            headers=h,
            files={"file": ("renamed-invoice.pdf", pdf, "application/pdf")},
        )
        assert second.status_code == 200, second.text
        body = second.json()
        assert body["duplicate"] is True
        assert body["duplicate_type"] == "EXACT_FILE"
        assert body["case_id"] == first_case_id

        cases = client.get(
            "/api/v1/cases",
            headers=headers("admin-duplicate", "ADMIN"),
        )
        matching = [item for item in cases.json()["items"] if item["id"] == first_case_id]
        assert len(matching) == 1

        history = client.get(
            f"/api/v1/cases/{first_case_id}/history",
            headers=headers("processor-duplicate", "AP_PROCESSOR"),
        )
        assert history.status_code == 200, history.text
        event_types = [event["event_type"] for event in history.json()["events"]]
        assert "CASE_UPLOADED" in event_types
        assert "DUPLICATE_UPLOAD_DETECTED" in event_types



def test_business_duplicate_uses_supplier_invoice_and_company_identity():
    from api.database import connect
    from api.workflow import _find_business_duplicate
    from api.database import utc_now

    existing_id = str(uuid.uuid4())
    now = utc_now()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO ap_cases (
                id, file_name, stored_path, sha256, status, created_by,
                invoice_number, supplier_name, company_code, currency,
                total_amount, extracted_fields_json, line_items_json,
                validation_json, confirmed_checks_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', '[]', '{}', '[]', ?, ?)
            """,
            (
                existing_id, "existing.pdf", "/tmp/existing.pdf",
                "test-business-duplicate-hash-" + existing_id, "NEEDS_REVIEW",
                "test-supplier", "INV-BUS-001", "Example Supplier", "1000",
                "SAR", "1250.00", now, now,
            ),
        )

    match = _find_business_duplicate(
        "new-case-not-in-db",
        {
            "invoice_number": " inv-bus-001 ",
            "supplier_name": "example supplier",
            "company_code": "1000",
            "currency": "SAR",
            "total_amount": "1250.00",
        },
    )
    assert match is not None
    assert match["matched_case_id"] == existing_id
    assert match["match_basis"] == "supplier_invoice_number_company_code"


def test_process_document_runs_po_matching_against_sap_excel_data(monkeypatch):
    import agents.mock_agents as mock_agents

    class LensWithPurchaseOrder(mock_agents.MockLensAgent):
        def run(self, file_path, classification):
            result = super().run(file_path, classification)
            # PO 4500000002 exists in the EKKO export with supplier 1000001001 (company MAH1, INR).
            result["converted"]["invoice_source"] = {
                "po_number": "4500000002", "vendor_number": "9999999999",
                "company_code": "MAH1", "currency": "INR", "total_amount": "100.00",
            }
            return result

    monkeypatch.setattr(mock_agents, "MockLensAgent", LensWithPurchaseOrder)
    with TestClient(app) as client:
        before = client.get("/api/v1/cases", headers=headers("processor-1", "AP_PROCESSOR")).json()["total"]
        response = client.post(
            "/internal/v1/process-document",
            data={"file_name": "invoice.pdf"},
            files={"file": ("invoice.pdf", b"%PDF-1.4\n% mock\n%%EOF", "application/pdf")},
        )
        assert response.status_code == 200, response.text
        validation = response.json()["validation"]
        agents_run = [step["agent"] for step in validation["agent_trace"]]
        assert agents_run == ["TOWER", "LENS", "FINANCE_RULES", "VECTOR", "SOURCE_CHECK", "PRISM"]
        assert validation["source_verdict"]["status"] == "MISMATCH"
        assert validation["checks"]["po"] == "FAIL"
        assert "SUPPLIER_MISMATCH" in validation["matching"]["reason_codes"]
        assert validation["matching"]["evidence"][0]["source"] == "LOCAL_SAP_EXCEL_EXPORT"
        assert validation["investigation"]["status"] == "NEEDS_INVESTIGATION"
        after = client.get("/api/v1/cases", headers=headers("processor-1", "AP_PROCESSOR")).json()["total"]
        assert after == before
