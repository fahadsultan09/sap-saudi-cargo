from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from decimal import Decimal, InvalidOperation
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, File, Header, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .auth import get_actor, require_roles
from .config import (AGENT_MODE, ALLOWED_EXTENSIONS, APPROVER_MAX_AMOUNT, APP_ENV, AUTH_MODE,
                     MAX_UPLOAD_MB, UPLOAD_DIR, validate_config)
from .database import audit, connect, init_db, json_dump, json_load, row_to_case, transaction, utc_now
from .schemas import Actor, DecisionRequest, FieldCorrection, HealthResponse, SubmitForApproval
from .workflow import process_case

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("ap_api")

validate_config()
@asynccontextmanager
async def lifespan(application: FastAPI):
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    init_db()
    logger.info("AP workflow API started, env=%s auth_mode=%s", APP_ENV, AUTH_MODE)
    yield


app = FastAPI(title="SACC AP Invoice Workflow API", version="1.0.0",
              description="Invoice triage, human review, finance approval and audit API.", lifespan=lifespan)

# Set AP_CORS_ORIGINS to the exact UI5 origin(s) in deployment. Avoid wildcard credentials.
_origins = [x.strip() for x in os.getenv("AP_CORS_ORIGINS", "http://localhost:8080,http://localhost:5173").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_credentials=True,
                   allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
                   allow_headers=["Authorization", "Content-Type", "X-User-Id", "X-User-Role", "X-User-Email", "Idempotency-Key"])

ALLOWED_EDIT_FIELDS = {"invoice_number", "supplier_name", "supplier_id", "company_code", "currency",
                       "total_amount", "invoice_date", "po_number", "document_type", "invoice_type"}
REQUIRED_INVOICE_FIELDS = ("invoice_number", "supplier_name", "currency", "total_amount")
REQUIRED_REVIEW_CHECKS = {"vendor", "tax", "duplicate"}


def _case_or_404(conn, case_id: str):
    row = conn.execute("SELECT * FROM ap_cases WHERE id = ?", (case_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return row


def _can_view(actor: Actor, row) -> bool:
    if actor.role == "ADMIN" or row["created_by"] == actor.user_id:
        return True
    if actor.role in {"AP_APPROVER", "FINANCE_MANAGER"}:
        if row["status"] in {"PENDING_APPROVAL", "APPROVED", "POSTING", "POSTED", "POSTING_ERROR"}:
            return True
        return False
    return actor.role == "AP_PROCESSOR" and row["status"] in {"NEEDS_REVIEW", "RETURNED", "PROCESSING_ERROR"}


def _audit_event(conn, case_id: str, event_type: str, actor: Actor, *, reason: str = "",
                 before: Any = None, after: Any = None, metadata: Any = None, correlation_id: str | None = None) -> None:
    audit(conn, event_id=str(uuid.uuid4()), case_id=case_id, event_type=event_type,
          actor_id=actor.user_id, actor_role=actor.role, reason=reason,
          before=before, after=after, metadata=metadata, correlation_id=correlation_id)


def _required_fields_missing(row) -> list[str]:
    fields = json_load(row["extracted_fields_json"], {})
    values = {
        "invoice_number": row["invoice_number"] or fields.get("invoice_number"),
        "supplier_name": row["supplier_name"] or fields.get("supplier_name"),
        "currency": row["currency"] or fields.get("currency"),
        "total_amount": row["total_amount"] or fields.get("total_amount"),
    }
    return [name for name in REQUIRED_INVOICE_FIELDS if values.get(name) in (None, "", [])]


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="sacc-ap-workflow-api", auth_mode=AUTH_MODE)


@app.get("/api/v1/me")
def me(actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    return {"user_id": actor.user_id, "role": actor.role, "email": actor.email}


@app.get("/api/v1/agents")
def list_agents(actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    """Describe the implemented Tier 1 agent flow and explicitly deferred agents."""
    return {
        "mode": AGENT_MODE,
        "orchestrator": "APAgentOrchestrator",
        "execution_order": ["TOWER", "LENS", "FINANCE_RULES"],
        "agents": [
            {"name": "TOWER", "kind": "classification agent adapter", "status": "running_mock" if AGENT_MODE == "mock" else ("enabled" if AGENT_MODE == "sap" else "disabled"), "purpose": "Classify the document and recommend the processing path", "service": "SAP AI Core" if AGENT_MODE == "sap" else ("offline filename heuristic" if AGENT_MODE == "mock" else "not invoked")},
            {"name": "LENS", "kind": "extraction agent adapter", "status": "running_mock" if AGENT_MODE == "mock" else ("enabled" if AGENT_MODE == "sap" else "disabled"), "purpose": "Extract invoice fields for invoices and credit notes", "service": "SAP Document AI" if AGENT_MODE == "sap" else ("offline empty-result adapter" if AGENT_MODE == "mock" else "not invoked"), "runs_when": "TOWER classification is invoice or credit_note"},
            {"name": "FINANCE_RULES", "kind": "deterministic component, not an LLM agent", "status": "enabled", "purpose": "Run existing triage validation rules; models cannot approve or set case status"},
            {"name": "VECTOR", "kind": "future agent", "status": "deferred", "purpose": "PO matching and G/L mapping; requires trusted SAP PO/vendor data adapter"},
            {"name": "PRISM", "kind": "future agent", "status": "deferred", "purpose": "Multi-step discrepancy investigation; not needed for Tier 1"},
        ],
        "invariants": ["Agents do not approve invoices", "Agents do not set case status", "No SAP posting is performed by this workflow"],
    }


@app.post("/api/v1/cases/upload", status_code=status.HTTP_202_ACCEPTED)
async def upload_invoice(background_tasks: BackgroundTasks, file: UploadFile = File(...),
                         actor: Actor = Depends(require_roles("AP_PROCESSOR", "ADMIN")),
                         x_correlation_id: str | None = Header(default=None)) -> dict[str, Any]:
    original_name = Path(file.filename or "invoice.pdf").name
    extension = Path(original_name).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Supported formats: PDF, PNG, JPG, JPEG")
    content = await file.read(MAX_UPLOAD_MB * 1024 * 1024 + 1)
    await file.close()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(content) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Maximum upload size is {MAX_UPLOAD_MB} MB")
    # Lightweight signature checks avoid trusting a filename alone.
    if extension == ".pdf" and not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="The uploaded file does not look like a PDF")
    if extension == ".png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(status_code=415, detail="The uploaded file does not look like a PNG")
    if extension in {".jpg", ".jpeg"} and not content.startswith(b"\xff\xd8\xff"):
        raise HTTPException(status_code=415, detail="The uploaded file does not look like a JPEG")

    sha = hashlib.sha256(content).hexdigest()
    case_id = str(uuid.uuid4())
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored_path = UPLOAD_DIR / f"{case_id}{extension}"
    stored_path.write_bytes(content)
    now = utc_now()
    try:
        with transaction() as conn:
            possible_duplicates = conn.execute("SELECT id, status FROM ap_cases WHERE sha256 = ?", (sha,)).fetchall()
            status_value = "RECEIVED"
            review_reason = None
            if possible_duplicates:
                status_value = "NEEDS_REVIEW"
                review_reason = "Possible duplicate file detected. Compare with existing cases before processing."
            conn.execute("""INSERT INTO ap_cases
                (id, file_name, stored_path, sha256, status, created_by, review_reason,
                 extracted_fields_json, line_items_json, validation_json, confirmed_checks_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '[]', ?, '[]', ?, ?)""",
                (case_id, original_name, str(stored_path), sha, status_value, actor.user_id, review_reason,
                 json_dump({"possible_duplicates": [dict(x) for x in possible_duplicates]}), now, now))
            _audit_event(conn, case_id, "CASE_UPLOADED", actor, reason="Invoice uploaded",
                         after={"status": status_value, "file_name": original_name, "sha256": sha},
                         metadata={"size_bytes": len(content), "content_type": file.content_type,
                                   "possible_duplicate_case_ids": [x["id"] for x in possible_duplicates]},
                         correlation_id=x_correlation_id)
    except Exception:
        stored_path.unlink(missing_ok=True)
        raise
    if status_value == "RECEIVED":
        background_tasks.add_task(process_case, case_id)
    return {"case_id": case_id, "status": status_value, "file_name": original_name,
            "possible_duplicate_case_ids": [x["id"] for x in possible_duplicates],
            "message": "Accepted. Poll the case endpoint for processing status."}

@app.get("/api/v1/cases")
def list_cases(status_filter: str | None = Query(default=None, alias="status"), limit: int = Query(default=50, ge=1, le=200),
               offset: int = Query(default=0, ge=0), actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    with connect() as conn:
        if status_filter:
            rows = conn.execute("SELECT * FROM ap_cases WHERE status=? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                                (status_filter.upper(), limit, offset)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM ap_cases ORDER BY created_at DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()
        items = [row_to_case(r) for r in rows if _can_view(actor, r)]
        total = conn.execute("SELECT COUNT(*) FROM ap_cases").fetchone()[0]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@app.get("/api/v1/cases/{case_id}")
def get_case(case_id: str, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    with connect() as conn:
        row = _case_or_404(conn, case_id)
        if not _can_view(actor, row):
            raise HTTPException(status_code=403, detail="You cannot view this case")
        item = row_to_case(row)
        item["possible_duplicate_cases"] = json_load(row["validation_json"], {}).get("possible_duplicates", [])
        return item


@app.get("/api/v1/cases/{case_id}/document")
def get_document(case_id: str, actor: Actor = Depends(get_actor)):
    with connect() as conn:
        row = _case_or_404(conn, case_id)
        if not _can_view(actor, row):
            raise HTTPException(status_code=403, detail="You cannot view this document")
        path = Path(row["stored_path"])
        name = row["file_name"]
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Stored document not found")
    media_type = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media_type, filename=name, content_disposition_type="inline")


@app.patch("/api/v1/cases/{case_id}/fields")
def correct_fields(case_id: str, body: FieldCorrection, actor: Actor = Depends(require_roles("AP_PROCESSOR", "ADMIN")),
                   x_correlation_id: str | None = Header(default=None)) -> dict[str, Any]:
    unknown = set(body.fields) - ALLOWED_EDIT_FIELDS
    if unknown:
        raise HTTPException(status_code=422, detail={"message": "Unsupported fields", "fields": sorted(unknown)})
    if not body.fields:
        raise HTTPException(status_code=422, detail="At least one field correction is required")
    with transaction() as conn:
        row = _case_or_404(conn, case_id)
        if row["status"] not in {"NEEDS_REVIEW", "RETURNED", "PROCESSING_ERROR"}:
            raise HTTPException(status_code=409, detail=f"Fields cannot be edited while case is {row['status']}")
        old_fields = json_load(row["extracted_fields_json"], {})
        merged = dict(old_fields)
        before_values = {}
        after_values = {}
        for key, value in body.fields.items():
            old_value = row[key] if key in row.keys() else old_fields.get(key)
            if key == "total_amount" and value not in (None, ""):
                try:
                    value = str(Decimal(str(value)))
                except (InvalidOperation, ValueError):
                    raise HTTPException(status_code=422, detail="total_amount must be a valid decimal number")
                if Decimal(value) < 0:
                    raise HTTPException(status_code=422, detail="total_amount cannot be negative")
            if key == "currency" and value:
                value = str(value).upper().strip()
                if len(value) != 3:
                    raise HTTPException(status_code=422, detail="currency must be a 3-letter code")
            merged[key] = value
            before_values[key] = old_value
            after_values[key] = value
        assignments = [f"{key}=?" for key in body.fields]
        params = [merged.get(key) for key in body.fields]
        validation = json_load(row["validation_json"], {})
        # Corrections can resolve extraction-missing flags, but do not silently pass other business checks.
        corrected_names = set(body.fields)
        validation["missing_fields"] = [name for name in validation.get("missing_fields", []) if name not in corrected_names]
        conn.execute(f"UPDATE ap_cases SET {', '.join(assignments)}, extracted_fields_json=?, validation_json=?, last_edited_by=?, updated_at=?, version=version+1 WHERE id=?",
                     (*params, json_dump(merged), json_dump(validation), actor.user_id, utc_now(), case_id))
        _audit_event(conn, case_id, "FIELDS_CORRECTED", actor, reason=body.comment, before=before_values,
                     after=after_values, metadata={"changed_fields": list(body.fields)}, correlation_id=x_correlation_id)
        fresh = _case_or_404(conn, case_id)
        return row_to_case(fresh)


@app.post("/api/v1/cases/{case_id}/submit-for-approval", status_code=202)
def submit_for_approval(case_id: str, body: SubmitForApproval, actor: Actor = Depends(require_roles("AP_PROCESSOR", "ADMIN")),
                        x_correlation_id: str | None = Header(default=None)) -> dict[str, Any]:
    with transaction() as conn:
        row = _case_or_404(conn, case_id)
        if row["status"] not in {"NEEDS_REVIEW", "RETURNED", "PROCESSING_ERROR"}:
            raise HTTPException(status_code=409, detail=f"Case cannot be submitted from {row['status']}")
        missing = _required_fields_missing(row)
        if missing:
            raise HTTPException(status_code=422, detail={"message": "Required invoice fields are missing", "fields": missing})
        checks = set(body.confirmed_checks)
        if not REQUIRED_REVIEW_CHECKS.issubset(checks):
            raise HTTPException(status_code=422, detail={"message": "Confirm the vendor, tax and duplicate checks before submission",
                                                        "required_checks": sorted(REQUIRED_REVIEW_CHECKS)})
        fields = json_load(row["extracted_fields_json"], {})
        # A PO check is mandatory only when a PO number exists. Non-PO invoices require a comment documenting the path.
        if row["po_number"] or fields.get("po_number"):
            if "po" not in checks:
                raise HTTPException(status_code=422, detail="Confirm the PO check for this PO-backed invoice")
        elif not any(term in body.comment.lower() for term in ("non-po", "non po", "no po")):
            raise HTTPException(status_code=422, detail="For a non-PO invoice, explain the non-PO path in the comment")
        # Block obvious extraction validation failures until corrected in the review screen.
        validation = json_load(row["validation_json"], {})
        missing_from_triage = validation.get("missing_fields", [])
        if missing_from_triage:
            raise HTTPException(status_code=422, detail={"message": "Resolve triage missing fields before approval", "fields": missing_from_triage})
        approval_id = str(uuid.uuid4())
        now = utc_now()
        before = {"status": row["status"], "version": row["version"]}
        conn.execute("INSERT INTO approval_requests (id, case_id, stage, status, policy_version, created_at) VALUES (?, ?, 1, 'PENDING', 'poc-v1', ?)",
                     (approval_id, case_id, now))
        conn.execute("UPDATE ap_cases SET status='PENDING_APPROVAL', confirmed_checks_json=?, review_reason=NULL, updated_at=?, version=version+1 WHERE id=?",
                     (json_dump(sorted(checks)), now, case_id))
        _audit_event(conn, case_id, "APPROVAL_REQUESTED", actor, reason=body.comment, before=before,
                     after={"status": "PENDING_APPROVAL", "approval_request_id": approval_id},
                     metadata={"confirmed_checks": sorted(checks), "policy_version": "poc-v1"}, correlation_id=x_correlation_id)
        return {"case_id": case_id, "approval_request_id": approval_id, "status": "PENDING_APPROVAL"}


@app.get("/api/v1/approvals")
def approval_queue(status_filter: str = Query(default="PENDING", alias="status"), limit: int = Query(default=50, ge=1, le=200),
                   offset: int = Query(default=0, ge=0), actor: Actor = Depends(require_roles("AP_APPROVER", "FINANCE_MANAGER", "ADMIN"))) -> dict[str, Any]:
    with connect() as conn:
        rows = conn.execute("""SELECT ar.id AS approval_request_id, ar.stage, ar.status AS approval_status,
            ar.assigned_approver_id, ar.created_at AS requested_at, c.*
            FROM approval_requests ar JOIN ap_cases c ON c.id=ar.case_id
            WHERE ar.status=? AND c.status='PENDING_APPROVAL'
            ORDER BY ar.created_at ASC LIMIT ? OFFSET ?""", (status_filter.upper(), limit, offset)).fetchall()
        items = []
        for row in rows:
            if row["assigned_approver_id"] and row["assigned_approver_id"] != actor.user_id and actor.role != "ADMIN":
                continue
            case = row_to_case(row)
            case.update({"approval_request_id": row["approval_request_id"], "approval_stage": row["stage"],
                         "approval_status": row["approval_status"], "requested_at": row["requested_at"]})
            items.append(case)
        total = conn.execute("SELECT COUNT(*) FROM approval_requests WHERE status=?", (status_filter.upper(),)).fetchone()[0]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


def _assert_approvable(actor: Actor, row) -> None:
    if actor.role not in {"AP_APPROVER", "FINANCE_MANAGER"}:
        raise HTTPException(status_code=403, detail="Only authorized finance approvers can decide")
    if row["created_by"] == actor.user_id or (row["last_edited_by"] and row["last_edited_by"] == actor.user_id):
        raise HTTPException(status_code=403, detail="Segregation of duties: preparer/editor cannot approve their own invoice")
    try:
        amount = Decimal(str(row["total_amount"] or "0"))
        max_amount = Decimal(APPROVER_MAX_AMOUNT)
    except InvalidOperation as exc:
        raise HTTPException(status_code=422, detail="Invoice amount or approval limit is invalid") from exc
    if actor.role == "AP_APPROVER" and amount > max_amount:
        raise HTTPException(status_code=403, detail="Invoice amount exceeds your approval limit; finance manager approval is required")


def _decide(case_id: str, body: DecisionRequest, actor: Actor, decision: str,
            x_correlation_id: str | None = None) -> dict[str, Any]:
    with transaction() as conn:
        row = _case_or_404(conn, case_id)
        if row["status"] != "PENDING_APPROVAL":
            raise HTTPException(status_code=409, detail=f"Case is not awaiting approval (current status: {row['status']})")
        _assert_approvable(actor, row)
        approval = conn.execute("SELECT * FROM approval_requests WHERE case_id=? AND status='PENDING' ORDER BY created_at DESC LIMIT 1", (case_id,)).fetchone()
        if approval is None:
            raise HTTPException(status_code=409, detail="Pending approval request not found")
        before = {"case_status": row["status"], "approval_status": approval["status"]}
        now = utc_now()
        new_status = {"APPROVE": "APPROVED", "RETURN": "RETURNED", "REJECT": "REJECTED"}[decision]
        conn.execute("UPDATE approval_requests SET status=?, completed_at=? WHERE id=?", ("APPROVED" if decision == "APPROVE" else decision + "ED", now, approval["id"]))
        conn.execute("INSERT INTO approval_decisions (id, approval_request_id, case_id, decision, actor_id, actor_role, comment, policy_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                     (str(uuid.uuid4()), approval["id"], case_id, decision, actor.user_id, actor.role, body.comment, approval["policy_version"], now))
        conn.execute("UPDATE ap_cases SET status=?, review_reason=?, updated_at=?, version=version+1 WHERE id=?",
                     (new_status, body.comment if decision != "APPROVE" else None, now, case_id))
        _audit_event(conn, case_id, f"APPROVAL_{decision}D" if decision != "RETURN" else "APPROVAL_RETURNED", actor,
                     reason=body.comment, before=before, after={"case_status": new_status, "approval_status": decision},
                     metadata={"approval_request_id": approval["id"], "policy_version": approval["policy_version"]},
                     correlation_id=x_correlation_id)
        if decision == "APPROVE":
            # This creates a durable placeholder only. No SAP posting is attempted by this POC endpoint.
            conn.execute("INSERT INTO posting_records (id, case_id, idempotency_key, status, company_code, created_at, updated_at) VALUES (?, ?, ?, 'NOT_CONFIGURED', ?, ?, ?)",
                         (str(uuid.uuid4()), case_id, f"ap-case:{case_id}:posting:v1", row["company_code"], now, now))
            _audit_event(conn, case_id, "POSTING_WAITING_FOR_INTEGRATION", actor,
                         reason="Approved. SAP posting adapter is not configured in this POC.",
                         after={"posting_status": "NOT_CONFIGURED"}, metadata={"idempotency_key": f"ap-case:{case_id}:posting:v1"},
                         correlation_id=x_correlation_id)
        return {"case_id": case_id, "status": new_status, "decision": decision,
                "message": "Approval recorded. SAP posting is not enabled by this POC." if decision == "APPROVE" else "Decision recorded."}


@app.post("/api/v1/cases/{case_id}/approve")
def approve_case(case_id: str, body: DecisionRequest, actor: Actor = Depends(require_roles("AP_APPROVER", "FINANCE_MANAGER")),
                 x_correlation_id: str | None = Header(default=None)) -> dict[str, Any]:
    return _decide(case_id, body, actor, "APPROVE", x_correlation_id)


@app.post("/api/v1/cases/{case_id}/return")
def return_case(case_id: str, body: DecisionRequest, actor: Actor = Depends(require_roles("AP_APPROVER", "FINANCE_MANAGER")),
                x_correlation_id: str | None = Header(default=None)) -> dict[str, Any]:
    return _decide(case_id, body, actor, "RETURN", x_correlation_id)


@app.post("/api/v1/cases/{case_id}/reject")
def reject_case(case_id: str, body: DecisionRequest, actor: Actor = Depends(require_roles("AP_APPROVER", "FINANCE_MANAGER")),
                x_correlation_id: str | None = Header(default=None)) -> dict[str, Any]:
    return _decide(case_id, body, actor, "REJECT", x_correlation_id)


@app.get("/api/v1/cases/{case_id}/history")
def case_history(case_id: str, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    with connect() as conn:
        row = _case_or_404(conn, case_id)
        if not _can_view(actor, row):
            raise HTTPException(status_code=403, detail="You cannot view this case history")
        events = conn.execute("SELECT * FROM audit_events WHERE case_id=? ORDER BY created_at ASC", (case_id,)).fetchall()
        decisions = conn.execute("SELECT * FROM approval_decisions WHERE case_id=? ORDER BY created_at ASC", (case_id,)).fetchall()
    return {"case_id": case_id,
            "events": [{**dict(e), "before": json_load(e["before_json"], None), "after": json_load(e["after_json"], None),
                        "metadata": json_load(e["metadata_json"], {})} for e in events],
            "decisions": [dict(d) for d in decisions]}
