from __future__ import annotations
import hashlib, hmac, os, uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse

from .config import APP_ENV, DB_PATH, LEASE_SECONDS, MAX_WORK_ATTEMPTS, SERVICE_API_KEY
from .db import connect, dumps, init_db, loads, now, transaction
from .schemas import Actor, AgentResult, Decision, ExtractionResult, FieldCorrection, LeaseRequest, ProgressUpdate, RegisterUpload, TransitionRequest, WorkCompletion

app = FastAPI(title="AP Automation · AP Core", version="0.1.0", description="Business state authority for AP automation. Agents advise; AP Core commits state and decides next steps.")

@app.on_event("startup")
def startup() -> None:
    if APP_ENV != "development" and not SERVICE_API_KEY:
        raise RuntimeError("AP_CORE_SERVICE_API_KEY must be configured outside development")
    init_db()


def service_auth(x_ap_core_key: str | None = Header(default=None)) -> None:
    if SERVICE_API_KEY:
        if not x_ap_core_key or not hmac.compare_digest(x_ap_core_key, SERVICE_API_KEY):
            raise HTTPException(status_code=401, detail="Invalid AP Core service key")
    elif APP_ENV != "development":
        raise HTTPException(status_code=503, detail="Service authentication is not configured")


PROCESSOR_ROLES = {"AP_PROCESSOR", "ADMIN"}
APPROVER_ROLES = {"AP_APPROVER", "FINANCE_MANAGER"}


def require_roles(*roles: str):
    """The person behind a call, as sent by the gateway with its service key, holding one of the roles."""
    def dependency(x_user_id: str | None = Header(default=None), x_user_role: str | None = Header(default=None)) -> Actor:
        if not x_user_id:
            raise HTTPException(status_code=401, detail="Signed-in user is missing")
        if x_user_role not in roles:
            raise HTTPException(status_code=403, detail="Your role does not allow this action")
        return Actor(user_id=x_user_id, role=x_user_role)
    return Depends(dependency)


def event(conn, case_id: str, event_type: str, decision_class: str, actor: str, reason: str = "", payload: Any = None, correlation_id: str | None = None) -> None:
    conn.execute("INSERT INTO audit_events(id,case_id,event_type,decision_class,actor,reason,payload_json,correlation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      (str(uuid.uuid4()),case_id,event_type,decision_class,actor,reason,dumps(payload or {}),correlation_id,now()))


def case_dict(row) -> dict[str, Any]:
    d = dict(row)
    d["fields"] = loads(d.pop("fields_json", "{}"), {})
    d["validation"] = loads(d.pop("validation_json", "{}"), {})
    return d

@app.get("/health")
def health():
    return {"status":"ok","service":"ap-core","version":"0.1.0"}

@app.get("/api/v1/cases/{case_id}", dependencies=[Depends(service_auth)])
def get_case(case_id: str):
    with connect() as c:
        row = c.execute("SELECT * FROM cases WHERE id=?",(case_id,)).fetchone()
    if not row: raise HTTPException(404,"Case not found")
    return case_dict(row)

@app.get("/api/v1/cases", dependencies=[Depends(service_auth)])
def list_cases(status_filter: str | None = Query(default=None, alias="status"), limit: int = Query(default=50,ge=1,le=200), offset: int = Query(default=0,ge=0)):
    with connect() as c:
        if status_filter:
            rows=c.execute("SELECT * FROM cases WHERE status=? ORDER BY created_at DESC LIMIT ? OFFSET ?",(status_filter.upper(),limit,offset)).fetchall()
            total=c.execute("SELECT COUNT(*) n FROM cases WHERE status=?",(status_filter.upper(),)).fetchone()["n"]
        else:
            rows=c.execute("SELECT * FROM cases ORDER BY created_at DESC LIMIT ? OFFSET ?",(limit,offset)).fetchall()
            total=c.execute("SELECT COUNT(*) n FROM cases").fetchone()["n"]
    return {"items":[case_dict(r) for r in rows],"total":total,"limit":limit,"offset":offset}

@app.post("/api/v1/cases/upload", dependencies=[Depends(service_auth)])
async def upload_invoice(
    file: UploadFile = File(...),
    source: str = Form(default="frontend"),
    correlation_id: str | None = Form(default=None),
    actor: Actor = require_roles(*PROCESSOR_ROLES),
):
    """Store a PDF invoice and register its case and processing work item."""
    created_by = actor.user_id
    filename = os.path.basename((file.filename or "invoice.pdf").replace("\\", "/"))
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Only PDF invoices are supported")

    storage_root = DB_PATH.parent / "documents"
    storage_root.mkdir(parents=True, exist_ok=True)
    document_id = str(uuid.uuid4())
    temp_path = storage_root / f".{document_id}.upload"
    digest = hashlib.sha256()
    size = 0
    max_bytes = 25 * 1024 * 1024
    prefix = b""
    final_path = None

    try:
        with temp_path.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                if not prefix:
                    prefix = chunk[:5]
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(status_code=413, detail="PDF exceeds the 25 MiB upload limit")
                digest.update(chunk)
                out.write(chunk)
        if prefix != b"%PDF-":
            raise HTTPException(status_code=415, detail="Uploaded file does not have a valid PDF signature")

        sha = digest.hexdigest()
        stamp = now()
        case_id = str(uuid.uuid4())
        storage_key = f"{document_id}.pdf"
        final_path = storage_root / storage_key

        with transaction() as c:
            existing = c.execute("SELECT * FROM cases WHERE sha256=?", (sha,)).fetchone()
            if existing:
                event(c, existing["id"], "DUPLICATE_UPLOAD_DETECTED", "FACT", created_by,
                      "Exact SHA-256 match; existing canonical case reused.",
                      {"sha256": sha, "incoming_file_name": filename}, correlation_id)
                return {
                    "case_id": existing["id"], "status": existing["status"],
                    "duplicate": True, "duplicate_type": "EXACT_FILE",
                    "document_ref": existing["document_ref"],
                    "message": "Existing case returned; no second work item created."
                }

            os.replace(temp_path, final_path)
            c.execute(
                "INSERT INTO cases(id,source,file_name,sha256,document_ref,status,created_by,created_at,updated_at) "
                "VALUES(?,?,?,?,?,'RECEIVED',?,?,?)",
                (case_id, source, filename, sha, storage_key, created_by, stamp, stamp)
            )
            task_id = str(uuid.uuid4())
            key = f"process-document:{case_id}"
            payload = {"document_ref": storage_key, "file_name": filename, "sha256": sha, "content_type": "application/pdf"}
            c.execute(
                "INSERT INTO work_items(id,case_id,task_type,status,payload_json,attempts,max_attempts,available_at,idempotency_key,created_at,updated_at) "
                "VALUES(?,?,?,'QUEUED',?,0,?,?,?,?,?)",
                (task_id, case_id, "PROCESS_DOCUMENT", dumps(payload), MAX_WORK_ATTEMPTS, stamp, key, stamp, stamp)
            )
            c.execute(
                "INSERT INTO documents(id,case_id,storage_key,file_name,content_type,size_bytes,sha256,created_at) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (document_id, case_id, storage_key, filename, "application/pdf", size, sha, stamp)
            )
            event(c, case_id, "CASE_REGISTERED", "SYSTEM_ACTION", created_by,
                  "PDF stored; case and processing work item created.",
                  {"sha256": sha, "document_id": document_id, "work_item_id": task_id}, correlation_id)

        return {
            "case_id": case_id, "document_id": document_id, "document_ref": storage_key,
            "status": "RECEIVED", "duplicate": False, "work_item_id": task_id,
            "file_name": filename, "size_bytes": size, "sha256": sha,
            "message": "PDF stored and case/work item registered."
        }
    except HTTPException:
        if final_path:
            final_path.unlink(missing_ok=True)
        raise
    except Exception:
        if final_path:
            final_path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()
        temp_path.unlink(missing_ok=True)


@app.post("/internal/v1/cases/register-upload", dependencies=[Depends(service_auth)])
def register_upload(req: RegisterUpload):
    """Register a document whose bytes are stored by the intake service/DMS. Hash is exact-file identity."""
    sha=req.sha256.lower(); stamp=now(); case_id=str(uuid.uuid4())
    with transaction() as c:
        existing=c.execute("SELECT * FROM cases WHERE sha256=?",(sha,)).fetchone()
        if existing:
            event(c,existing["id"],"DUPLICATE_UPLOAD_DETECTED","FACT",req.created_by,"Exact SHA-256 match; existing canonical case reused.",{"sha256":sha,"incoming_file_name":req.file_name},req.correlation_id)
            return {"case_id":existing["id"],"status":existing["status"],"duplicate":True,"duplicate_type":"EXACT_FILE","message":"Existing case returned; no second work item created."}
        c.execute("INSERT INTO cases(id,source,file_name,sha256,document_ref,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'RECEIVED',?,?,?)",
          (case_id,req.source,req.file_name,sha,req.document_ref,req.created_by,stamp,stamp))
        task_id=str(uuid.uuid4()); key=f"process-document:{case_id}"
        c.execute("INSERT INTO work_items(id,case_id,task_type,status,payload_json,attempts,max_attempts,available_at,idempotency_key,created_at,updated_at) VALUES(?,?,?,'QUEUED','{}',0,?,?,?,?,?)",
          (task_id,case_id,"PROCESS_DOCUMENT",MAX_WORK_ATTEMPTS,stamp,key,stamp,stamp))
        event(c,case_id,"CASE_REGISTERED","SYSTEM_ACTION",req.created_by,"Document registered; processing work item created.",{"sha256":sha,"work_item_id":task_id},req.correlation_id)
    return {"case_id":case_id,"status":"RECEIVED","duplicate":False,"work_item_id":task_id,"message":"Case and work item committed atomically."}

@app.post("/internal/v1/work-items/lease", dependencies=[Depends(service_auth)])
def lease_work(req: LeaseRequest):
    """Lease one available task; expired leases are eligible for reclaim."""
    stamp=datetime.now(timezone.utc); stamp_s=stamp.isoformat(timespec="milliseconds"); until=(stamp+timedelta(seconds=req.lease_seconds)).isoformat(timespec="milliseconds")
    with transaction() as c:
        placeholders=",".join("?" for _ in req.task_types)
        if not req.task_types: raise HTTPException(400,"task_types cannot be empty")
        row=c.execute(f"SELECT * FROM work_items WHERE task_type IN ({placeholders}) AND available_at<=? AND attempts < max_attempts AND (status IN ('QUEUED','RETRY') OR (status='LEASED' AND lease_until<?)) ORDER BY created_at LIMIT 1",(*req.task_types,stamp_s,stamp_s)).fetchone()
        if not row: return {"work_item":None}
        c.execute("UPDATE work_items SET status='LEASED',lease_owner=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=?",(req.worker_id,until,stamp_s,row["id"]))
        c.execute("UPDATE cases SET status='PROCESSING',updated_at=?,version=version+1 WHERE id=? AND status IN ('RECEIVED','PROCESSING_ERROR')",(stamp_s,row["case_id"]))
        event(c,row["case_id"],"WORK_ITEM_LEASED","SYSTEM_ACTION",req.worker_id,"Worker leased document processing task.",{"work_item_id":row["id"],"attempt":row["attempts"]+1})
        return {"work_item":{"id":row["id"],"case_id":row["case_id"],"task_type":row["task_type"],"payload":loads(row["payload_json"],{}),"attempt":row["attempts"]+1,"lease_until":until}}

@app.post("/internal/v1/cases/{case_id}/agent-judgements", dependencies=[Depends(service_auth)])
def save_agent_judgement(case_id: str, req: AgentResult):
    """Persist an advisory model output. This endpoint never changes case status."""
    stamp=now()
    with transaction() as c:
        if not c.execute("SELECT 1 FROM cases WHERE id=?",(case_id,)).fetchone(): raise HTTPException(404,"Case not found")
        cur=c.execute("INSERT OR IGNORE INTO model_judgements(id,case_id,agent_name,judgement_type,payload_json,model_version,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?)",
          (str(uuid.uuid4()),case_id,req.agent_name,req.judgement_type,dumps(req.payload),req.model_version,req.idempotency_key,stamp))
        if cur.rowcount:
            event(c,case_id,"MODEL_JUDGEMENT_RECORDED","MODEL_JUDGEMENT",req.agent_name,"Agent recommendation stored; no business state transition performed.",{"judgement_type":req.judgement_type,"idempotency_key":req.idempotency_key},req.correlation_id)
    return {"accepted":True,"duplicate_submission":cur.rowcount==0,"decision_class":"MODEL_JUDGEMENT","state_changed":False}

def route_case(c, case_id: str, f: dict[str, Any], validation: dict[str, Any], correlation_id: str | None, summary: str | None = None) -> dict[str, Any]:
    """Apply the deterministic checks to a case's fields and commit the route. Used for agent extraction and human corrections alike.

    summary: the review reason to show instead of the generic one (the SAP data check's verdict).
    """
    stamp=now()
    # Normalize business identity. The extraction itself is an external observation, not a final decision.
    invoice=str(f.get("invoice_number") or "").strip()
    supplier_id=str(f.get("supplier_id") or "").strip()
    supplier_name=str(f.get("supplier_name") or "").strip()
    company=str(f.get("company_code") or "").strip()
    currency=str(f.get("currency") or "").strip().upper()
    po_number=str(f.get("po_number") or "").strip()
    amount=f.get("total_amount")
    duplicate=None
    if invoice and company and (supplier_id or supplier_name):
        if supplier_id:
            match=c.execute("SELECT id,status FROM cases WHERE id<>? AND lower(trim(coalesce(invoice_number,'')))=? AND lower(trim(coalesce(company_code,'')))=? AND lower(trim(coalesce(supplier_id,'')))=? AND status<>'REJECTED' ORDER BY created_at LIMIT 1",(case_id,invoice.casefold(),company.casefold(),supplier_id.casefold())).fetchone()
        else:
            match=c.execute("SELECT id,status FROM cases WHERE id<>? AND lower(trim(coalesce(invoice_number,'')))=? AND lower(trim(coalesce(company_code,'')))=? AND lower(trim(coalesce(supplier_name,'')))=? AND status<>'REJECTED' ORDER BY created_at LIMIT 1",(case_id,invoice.casefold(),company.casefold(),supplier_name.casefold())).fetchone()
        if match: duplicate={"matched_case_id":match["id"],"matched_case_status":match["status"],"rule":"SUPPLIER_INVOICE_COMPANY_MATCH"}
    required={"invoice_number":invoice,"supplier_name":supplier_name,"currency":currency,"total_amount":amount,"company_code":company}
    missing=[k for k,v in required.items() if v is None or str(v).strip()==""]
    blocking=[]
    if missing: blocking.append("REQUIRED_FIELDS_MISSING")
    if duplicate: blocking.append("POTENTIAL_BUSINESS_DUPLICATE")
    if validation.get("blocking"): blocking.extend([str(x) for x in validation["blocking"]])
    # Use Decimal for amount validation; never use binary float for financial arithmetic.
    amount_error=None
    if amount not in (None,""):
        try:
            if not Decimal(str(amount)).is_finite(): amount_error="AMOUNT_NOT_FINITE"
        except (InvalidOperation, ValueError): amount_error="AMOUNT_INVALID"
    if amount_error: blocking.append(amount_error)
    next_status="NEEDS_REVIEW" if blocking else "READY_FOR_APPROVAL"
    full_match=(validation.get("source_verdict") or {}).get("status")=="MATCH"
    if duplicate: reason="Potential duplicate invoice; compare with matched case."
    # A full-match verdict says "approve right away"; it must not be shown when AP Core's own checks block.
    elif summary and not (blocking and full_match): reason=summary
    elif blocking: reason="Required fields or validations need human review."
    else: reason="Required fields present; awaiting independent approval."
    # Agent checks (e.g. VECTOR's PO match) are kept; the duplicate check is AP Core's own.
    merged_validation={**validation,"blocking":list(dict.fromkeys(blocking)),"missing_fields":missing,"business_duplicate":duplicate,"checks":{**validation.get("checks",{}),"duplicate":"suspected_duplicate" if duplicate else "not_checked"}}
    c.execute("UPDATE cases SET invoice_number=?,supplier_id=?,supplier_name=?,company_code=?,currency=?,total_amount=?,invoice_date=?,po_number=?,fields_json=?,validation_json=?,status=?,review_reason=?,updated_at=?,version=version+1 WHERE id=?",
      (invoice or None,supplier_id or None,supplier_name or None,company or None,currency or None,str(amount) if amount is not None else None,f.get("invoice_date"),po_number or None,dumps(f),dumps(merged_validation),next_status,reason,stamp,case_id))
    c.execute("INSERT INTO rule_results(id,case_id,rule_code,outcome,reason,evidence_json,created_at) VALUES(?,?,?,?,?,?,?)",(str(uuid.uuid4()),case_id,"REQUIRED_FIELDS_PRESENT","FAIL" if missing else "PASS",f"Missing fields: {', '.join(missing)}" if missing else "All required invoice fields are present.",dumps({"missing_fields":missing}),stamp))
    c.execute("INSERT INTO rule_results(id,case_id,rule_code,outcome,reason,evidence_json,created_at) VALUES(?,?,?,?,?,?,?)",(str(uuid.uuid4()),case_id,"BUSINESS_DUPLICATE","FAIL" if duplicate else "PASS" if invoice and company else "UNKNOWN",reason,dumps(duplicate or {}),stamp))
    event(c,case_id,"CASE_ROUTED","RULE_RESULT","ap-core",reason,{"status":next_status,"blocking":merged_validation["blocking"]},correlation_id)
    return {"case_id":case_id,"status":next_status,"blocking":merged_validation["blocking"],"missing_fields":missing,"business_duplicate":duplicate,"next_step":"HUMAN_REVIEW" if next_status=="NEEDS_REVIEW" else "INDEPENDENT_APPROVAL"}

@app.post("/internal/v1/cases/{case_id}/progress", dependencies=[Depends(service_auth)])
def save_progress(case_id: str, req: ProgressUpdate):
    """Live progress for the UI while the agents run. Only for a case that is PROCESSING; it changes no
    business state and is replaced by the extraction result."""
    with transaction() as c:
        row=c.execute("SELECT status,validation_json FROM cases WHERE id=?",(case_id,)).fetchone()
        if not row: raise HTTPException(404,"Case not found")
        if row["status"]!="PROCESSING": return {"case_id":case_id,"accepted":False}
        validation={**loads(row["validation_json"],{}),"agent_trace":req.agent_trace,"source_checks":req.source_checks}
        c.execute("UPDATE cases SET validation_json=?,updated_at=? WHERE id=?",(dumps(validation),now(),case_id))
    return {"case_id":case_id,"accepted":True}

@app.post("/internal/v1/cases/{case_id}/extraction-result", dependencies=[Depends(service_auth)])
def submit_extraction(case_id: str, req: ExtractionResult):
    """Accept extraction observations, then AP Core applies deterministic checks and chooses the route."""
    with transaction() as c:
        row=c.execute("SELECT * FROM cases WHERE id=?",(case_id,)).fetchone()
        if not row: raise HTTPException(404,"Case not found")
        previous=c.execute("SELECT 1 FROM model_judgements WHERE idempotency_key=?",(req.idempotency_key,)).fetchone()
        if previous: return {"case_id":case_id,"duplicate_submission":True,"status":row["status"]}
        c.execute("INSERT OR IGNORE INTO model_judgements(id,case_id,agent_name,judgement_type,payload_json,model_version,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?)",(str(uuid.uuid4()),case_id,"LENS","EXTRACTION_RESULT",dumps(req.fields),None,req.idempotency_key,now()))
        event(c,case_id,"EXTRACTION_ACCEPTED","EXTERNAL_OBSERVATION","agentic-ai","Extraction persisted; deterministic routing applied next.",{"fields":sorted(req.fields)},req.correlation_id)
        # Marks that the agents delivered fields; it stays on the case through later corrections.
        validation={**req.validation,"agents_completed":True}
        blocking=list(validation.get("blocking",[]))
        verdict=validation.get("source_verdict") or {}
        if verdict.get("status")=="MATCH":
            # Every compared field is confirmed by the SAP data, so the agents' own review flags no longer
            # apply; AP Core's checks (required fields, duplicates, amount) still run in route_case.
            blocking=[code for code in blocking if code not in AGENT_REVIEW_FLAGS]
        elif verdict.get("status") in SOURCE_VERDICT_BLOCKS:
            blocking.append(SOURCE_VERDICT_BLOCKS[verdict["status"]])
        elif str(validation.get("checks",{}).get("po","")).upper()=="FAIL":
            # Without a verdict, VECTOR's PO match decides: a FAIL sends the case to a reviewer, UNKNOWN does not block.
            blocking.append("PO_MATCH_FAILED")
        validation["blocking"]=blocking
        return route_case(c,case_id,req.fields,validation,req.correlation_id,verdict.get("summary"))

# The SAP data check's verdict (agentic-ai SOURCE_CHECK): anything but a full match goes to a reviewer.
SOURCE_VERDICT_BLOCKS={"MISMATCH":"SOURCE_DATA_MISMATCH","NOT_FOUND":"SOURCE_DATA_NOT_FOUND","INCOMPLETE":"SOURCE_DATA_INCOMPLETE","ERROR":"SOURCE_DATA_CHECK_FAILED"}
AGENT_REVIEW_FLAGS={"TRIAGE_REVIEW_REQUIRED","EXTRACTION_NOT_COMPLETED"}

ALLOWED_TRANSITIONS={
 "RECEIVED":{"PROCESSING","NEEDS_REVIEW","PROCESSING_ERROR"},
 "PROCESSING":{"NEEDS_REVIEW","READY_FOR_APPROVAL","PROCESSING_ERROR"},
 "PROCESSING_ERROR":{"PROCESSING","NEEDS_REVIEW"},
 "NEEDS_REVIEW":{"RETURNED","READY_FOR_APPROVAL","REJECTED"},
 "RETURNED":{"NEEDS_REVIEW","REJECTED"},
 "READY_FOR_APPROVAL":{"PENDING_APPROVAL","NEEDS_REVIEW","REJECTED"},
 "PENDING_APPROVAL":{"APPROVED","RETURNED","REJECTED"},
 "APPROVED":{"POSTING"}, "POSTING":{"POSTED","POSTING_ERROR"}, "POSTING_ERROR":{"POSTING","POSTED"},
 "POSTED":set(),"REJECTED":set()
}

@app.post("/internal/v1/cases/{case_id}/transition", dependencies=[Depends(service_auth)])
def transition(case_id: str, req: TransitionRequest):
    stamp=now()
    with transaction() as c:
        row=c.execute("SELECT * FROM cases WHERE id=?",(case_id,)).fetchone()
        if not row: raise HTTPException(404,"Case not found")
        prior=c.execute("SELECT 1 FROM audit_events WHERE case_id=? AND event_type='STATE_TRANSITION' AND json_extract(payload_json,'$.idempotency_key')=?",(case_id,req.idempotency_key)).fetchone()
        if prior: return {"case_id":case_id,"status":row["status"],"duplicate_submission":True,"version":row["version"]}
        if req.expected_version is not None and req.expected_version!=row["version"]:
            raise HTTPException(409,detail={"code":"VERSION_CONFLICT","current_version":row["version"],"current_status":row["status"]})
        target=req.target_status.upper(); current=row["status"]
        if target not in ALLOWED_TRANSITIONS.get(current,set()):
            raise HTTPException(409,detail={"code":"INVALID_TRANSITION","from":current,"to":target})
        if target=="APPROVED":
            # Never trust a role string supplied by a worker/agent. Human approval needs a
            # separately authenticated approval route and an independently resolved actor.
            raise HTTPException(403,"Approval cannot be committed through the service transition endpoint; use the authenticated human approval workflow")
        if target=="POSTING":
            # Do not accept caller-supplied permit strings as authorization. The dedicated
            # posting-command service must issue and validate a signed permit in a later tranche.
            raise HTTPException(409,"SAP posting is not enabled in this AP Core build; implement the isolated posting-command service first")
        c.execute("UPDATE cases SET status=?,review_reason=?,updated_at=?,version=version+1 WHERE id=?",(target,req.reason,stamp,case_id))
        event(c,case_id,"STATE_TRANSITION",req.decision_class,req.actor,req.reason,{"from":current,"to":target,"idempotency_key":req.idempotency_key,**req.payload},req.correlation_id)
    return {"case_id":case_id,"status":target,"version":row["version"]+1,"duplicate_submission":False}

@app.get("/api/v1/cases/{case_id}/history", dependencies=[Depends(service_auth)])
@app.get("/internal/v1/cases/{case_id}/audit", dependencies=[Depends(service_auth)])
def get_audit(case_id: str):
    with connect() as c:
        if not c.execute("SELECT 1 FROM cases WHERE id=?",(case_id,)).fetchone(): raise HTTPException(404,"Case not found")
        # rowid keeps events of the same millisecond in the order they were written.
        rows=c.execute("SELECT * FROM audit_events WHERE case_id=? ORDER BY created_at,rowid",(case_id,)).fetchall()
    return {"items":[{**dict(r),"payload":loads(r["payload_json"],{})} for r in rows]}

@app.get("/internal/v1/cases/{case_id}/judgements", dependencies=[Depends(service_auth)])
def get_judgements(case_id: str):
    with connect() as c:
        rows=c.execute("SELECT * FROM model_judgements WHERE case_id=? ORDER BY created_at",(case_id,)).fetchall()
    return {"items":[{**dict(r),"payload":loads(r["payload_json"],{})} for r in rows]}

@app.get("/internal/v1/cases/{case_id}/rule-results", dependencies=[Depends(service_auth)])
def get_rule_results(case_id: str):
    with connect() as c:
        rows=c.execute("SELECT * FROM rule_results WHERE case_id=? ORDER BY created_at",(case_id,)).fetchall()
    return {"items":[{**dict(r),"evidence":loads(r["evidence_json"],{})} for r in rows]}

@app.post("/internal/v1/work-items/{work_item_id}/complete", dependencies=[Depends(service_auth)])
def complete_work(work_item_id: str, req: WorkCompletion):
    stamp=now()
    with transaction() as c:
        row=c.execute("SELECT * FROM work_items WHERE id=?",(work_item_id,)).fetchone()
        if not row: raise HTTPException(404,"Work item not found")
        if row["status"] in {"SUCCEEDED","FAILED"}: return {"work_item_id":work_item_id,"status":row["status"],"duplicate_submission":True}
        if row["status"]!="LEASED" or row["lease_owner"]!=req.worker_id: raise HTTPException(409,"Worker does not own the active lease")
        if req.outcome=="SUCCEEDED": state="SUCCEEDED"; available=stamp; err=None
        elif req.outcome=="RETRY" and row["attempts"]<row["max_attempts"]: state="RETRY"; available=(datetime.now(timezone.utc)+timedelta(seconds=min(300,2**row["attempts"]))).isoformat(timespec="milliseconds"); err=req.error
        else: state="FAILED"; available=stamp; err=req.error or "Worker failed"
        c.execute("UPDATE work_items SET status=?,available_at=?,lease_owner=NULL,lease_until=NULL,last_error=?,updated_at=? WHERE id=?",(state,available,err,stamp,work_item_id))
        # The technical error stays in the work item and the event payload; reasons are read by business users.
        reason={"SUCCEEDED":"Worker task completed.","RETRY":"Processing attempt failed; it will be retried.","FAILED":"Automatic processing failed."}[state]
        event(c,row["case_id"],"WORK_ITEM_COMPLETED","SYSTEM_ACTION",req.worker_id,reason,{"work_item_id":work_item_id,"outcome":req.outcome,"result":req.result,"error":err,"idempotency_key":req.idempotency_key})
        if state=="FAILED":
            c.execute("UPDATE cases SET status='PROCESSING_ERROR',review_reason=?,updated_at=?,version=version+1 WHERE id=? AND status='PROCESSING'",("Automatic processing failed. Enter the invoice details from the PDF on Clear Desk.",stamp,row["case_id"]))
    return {"work_item_id":work_item_id,"status":state,"attempts":row["attempts"],"available_at":available}


# Human workflow, called through the gateway on behalf of a signed-in user.

@app.get("/api/v1/cases/{case_id}/document", dependencies=[Depends(service_auth)])
def get_document(case_id: str):
    with connect() as c:
        doc=c.execute("SELECT * FROM documents WHERE case_id=? ORDER BY created_at DESC LIMIT 1",(case_id,)).fetchone()
    path=DB_PATH.parent/"documents"/doc["storage_key"] if doc else None
    if not path or not path.is_file(): raise HTTPException(404,"Stored document not found")
    return FileResponse(path,media_type=doc["content_type"],filename=doc["file_name"],content_disposition_type="inline")

@app.patch("/api/v1/cases/{case_id}/fields", dependencies=[Depends(service_auth)])
def correct_fields(case_id: str, req: FieldCorrection, actor: Actor = require_roles(*PROCESSOR_ROLES)):
    """A reviewer corrects extracted fields; AP Core then re-runs its deterministic checks and routes the case."""
    with transaction() as c:
        row=c.execute("SELECT * FROM cases WHERE id=?",(case_id,)).fetchone()
        if not row: raise HTTPException(404,"Case not found")
        if row["status"] not in {"NEEDS_REVIEW","RETURNED","PROCESSING_ERROR"}:
            raise HTTPException(409,detail={"code":"INVALID_TRANSITION","from":row["status"],"to":"NEEDS_REVIEW"})
        changes={k:(v or "").strip() or None for k,v in req.fields.items()}
        if changes.get("currency"):
            changes["currency"]=changes["currency"].upper()
            if len(changes["currency"])!=3: raise HTTPException(422,"Currency must be a 3-letter code")
        if changes.get("total_amount"):
            try: amount=Decimal(changes["total_amount"])
            except (InvalidOperation, ValueError): raise HTTPException(422,"Total amount must be a number") from None
            if not amount.is_finite() or amount<0: raise HTTPException(422,"Total amount must be zero or more")
        fields=loads(row["fields_json"],{})
        before={k:row[k] for k in changes}
        fields.update(changes)
        c.execute("UPDATE cases SET last_edited_by=? WHERE id=?",(actor.user_id,case_id))
        event(c,case_id,"FIELDS_CORRECTED","HUMAN_DECISION",actor.user_id,req.comment,{"role":actor.role,"before":before,"after":changes})
        if row["status"]!="NEEDS_REVIEW":
            event(c,case_id,"STATE_TRANSITION","SYSTEM_ACTION","ap-core","Reopened for review after correction.",{"from":row["status"],"to":"NEEDS_REVIEW"})
        # A person checked the fields against the document, so earlier agent flags no longer apply; AP Core's own rules run again.
        validation={**loads(row["validation_json"],{}),"blocking":[]}
        return route_case(c,case_id,fields,validation,None)

DECISIONS={"approve":("APPROVED","APPROVAL_APPROVED"),"return":("RETURNED","APPROVAL_RETURNED"),"reject":("REJECTED","APPROVAL_REJECTED")}

@app.post("/api/v1/cases/{case_id}/{decision}", dependencies=[Depends(service_auth)])
def decide(case_id: str, decision: Literal["approve","return","reject"], req: Decision, actor: Actor = require_roles(*APPROVER_ROLES)):
    """The authenticated human approval workflow: an approver's decision, within ALLOWED_TRANSITIONS."""
    target,event_type=DECISIONS[decision]; stamp=now(); comment=req.comment.strip()
    if target!="APPROVED" and len(comment)<3:
        raise HTTPException(422,"A comment of at least 3 characters is required to return or reject an invoice")
    with transaction() as c:
        row=c.execute("SELECT * FROM cases WHERE id=?",(case_id,)).fetchone()
        if not row: raise HTTPException(404,"Case not found")
        current=row["status"]
        if target=="APPROVED" and actor.user_id in {row["created_by"],row["last_edited_by"]}:
            raise HTTPException(403,"Approval must be independent: you uploaded or corrected this invoice")
        if current=="READY_FOR_APPROVAL" and target!="REJECTED":
            # The approver picking up the case is the approval request.
            event(c,case_id,"STATE_TRANSITION","SYSTEM_ACTION","ap-core","Approval requested.",{"from":current,"to":"PENDING_APPROVAL"})
            current="PENDING_APPROVAL"
        if target not in ALLOWED_TRANSITIONS.get(current,set()):
            raise HTTPException(409,detail={"code":"INVALID_TRANSITION","from":row["status"],"to":target})
        reason="Approved. SAP posting is not enabled in this AP Core build." if target=="APPROVED" else comment
        c.execute("UPDATE cases SET status=?,review_reason=?,updated_at=?,version=version+1 WHERE id=?",(target,reason,stamp,case_id))
        event(c,case_id,event_type,"HUMAN_DECISION",actor.user_id,comment or "Approved.",{"role":actor.role,"from":current,"to":target})
    return {"case_id":case_id,"status":target,"version":row["version"]+1}
