from __future__ import annotations

import os
import uuid
from pathlib import Path

# Isolate the API database before importing the application module.
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("AUTH_MODE", "dev")
os.environ["AP_DATA_DIR"] = str(Path("/tmp") / f"sacc-api-tests-{uuid.uuid4().hex}")
os.environ["SAP_PROCESSING_ENABLED"] = "false"

from fastapi.testclient import TestClient
from api.main import app


def headers(user: str, role: str) -> dict[str, str]:
    return {"X-User-Id": user, "X-User-Role": role}


def test_upload_review_submit_and_approve():
    with TestClient(app) as client:
        pdf = b"%PDF-1.4\n% mock test document\n%%EOF"
        upload = client.post("/api/v1/cases/upload", headers=headers("processor-1", "AP_PROCESSOR"),
                             files={"file": ("invoice.pdf", pdf, "application/pdf")})
        assert upload.status_code == 202, upload.text
        case_id = upload.json()["case_id"]
        detail = client.get(f"/api/v1/cases/{case_id}", headers=headers("processor-1", "AP_PROCESSOR"))
        assert detail.status_code == 200
        assert detail.json()["status"] == "NEEDS_REVIEW"

        correction = client.patch(f"/api/v1/cases/{case_id}/fields", headers=headers("processor-1", "AP_PROCESSOR"),
                                  json={"fields": {"invoice_number": "INV-1001", "supplier_name": "Example Supplier",
                                                   "currency": "SAR", "total_amount": "1250.50"},
                                        "comment": "Verified against the uploaded invoice"})
        assert correction.status_code == 200, correction.text

        submit = client.post(f"/api/v1/cases/{case_id}/submit-for-approval", headers=headers("processor-1", "AP_PROCESSOR"),
                             json={"comment": "Vendor, tax and duplicate checks completed. Non-PO invoice confirmed.",
                                   "confirmed_checks": ["vendor", "tax", "duplicate"]})
        assert submit.status_code == 202, submit.text
        queue = client.get("/api/v1/approvals", headers=headers("approver-1", "AP_APPROVER"))
        assert queue.status_code == 200
        assert any(item["id"] == case_id for item in queue.json()["items"])

        # Preparer cannot approve their own invoice.
        self_approve = client.post(f"/api/v1/cases/{case_id}/approve", headers=headers("processor-1", "AP_APPROVER"),
                                   json={"comment": "I approve"})
        assert self_approve.status_code == 403

        approve = client.post(f"/api/v1/cases/{case_id}/approve", headers=headers("approver-1", "AP_APPROVER"),
                              json={"comment": "Reviewed and approved under POC policy"})
        assert approve.status_code == 200, approve.text
        assert approve.json()["status"] == "APPROVED"
        assert "not enabled" in approve.json()["message"].lower()

        history = client.get(f"/api/v1/cases/{case_id}/history", headers=headers("approver-1", "AP_APPROVER"))
        assert history.status_code == 200
        event_types = [event["event_type"] for event in history.json()["events"]]
        assert "CASE_UPLOADED" in event_types
        assert "FIELDS_CORRECTED" in event_types
        assert "APPROVAL_REQUESTED" in event_types
        assert "APPROVAL_APPROVED" in event_types


def test_upload_rejects_unsupported_type():
    with TestClient(app) as client:
        response = client.post("/api/v1/cases/upload", headers=headers("processor-1", "AP_PROCESSOR"),
                               files={"file": ("invoice.exe", b"MZ", "application/octet-stream")})
        assert response.status_code == 415


def test_role_is_required():
    with TestClient(app) as client:
        response = client.get("/api/v1/approvals", headers=headers("processor-1", "AP_PROCESSOR"))
        assert response.status_code == 403


def test_agents_route_describes_minimum_architecture():
    with TestClient(app) as client:
        response = client.get("/api/v1/agents", headers=headers("admin-1", "ADMIN"))
        assert response.status_code == 200
        data = response.json()
        assert data["execution_order"] == ["TOWER", "LENS", "FINANCE_RULES"]
        assert next(agent for agent in data["agents"] if agent["name"] == "VECTOR")["status"] == "deferred"
