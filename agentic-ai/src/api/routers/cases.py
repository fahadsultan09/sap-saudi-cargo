from __future__ import annotations

import hashlib
import uuid
from pathlib import Path
from typing import Any

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Header,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, JSONResponse

from ..auth import get_actor, require_roles
from ..config import MAX_UPLOAD_MB, UPLOAD_DIR
from ..constants import ALLOWED_EDIT_FIELDS
from ..database import (
    connect,
    json_dump,
    json_load,
    row_to_case,
    transaction,
    utc_now,
)
from ..schemas import Actor, FieldCorrection
from ..services.audit_helper import audit_event
from ..services.case_access import can_view, case_or_404
from ..services.field_correction import normalize_field_value
from ..services.upload_validation import check_content, check_extension
from ..workflow import process_case

router = APIRouter(prefix="/api/v1/cases")


@router.post("/upload", status_code=status.HTTP_202_ACCEPTED)
async def upload_invoice(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    actor: Actor = Depends(require_roles("AP_PROCESSOR", "ADMIN")),
    x_correlation_id: str | None = Header(default=None),
) -> dict[str, Any]:
    original_name = Path(file.filename or "invoice.pdf").name
    extension = Path(original_name).suffix.lower()
    check_extension(extension)

    content = await file.read(MAX_UPLOAD_MB * 1024 * 1024 + 1)
    await file.close()
    check_content(extension, content)

    sha = hashlib.sha256(content).hexdigest()
    case_id = str(uuid.uuid4())
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored_path = UPLOAD_DIR / f"{case_id}{extension}"
    stored_path.write_bytes(content)
    now = utc_now()
    duplicate_case: dict[str, Any] | None = None
    try:
        with transaction() as conn:
            # SQLite BEGIN IMMEDIATE serializes writers. The unique sha256 key in
            # document_claims is the final guard against concurrent duplicate uploads.
            claim = conn.execute(
                """
                SELECT dc.canonical_case_id, c.status, c.created_by, c.file_name
                FROM document_claims dc
                JOIN ap_cases c ON c.id = dc.canonical_case_id
                WHERE dc.sha256 = ?
                """,
                (sha,),
            ).fetchone()

            if claim is not None:
                duplicate_case = dict(claim)
                conn.execute(
                    """
                    UPDATE document_claims
                    SET last_seen_at = ?, duplicate_count = duplicate_count + 1
                    WHERE sha256 = ?
                    """,
                    (now, sha),
                )
                audit_event(
                    conn,
                    duplicate_case["canonical_case_id"],
                    "DUPLICATE_UPLOAD_DETECTED",
                    actor,
                    reason="An identical file was uploaded again; no new case or processing job was created.",
                    after={
                        "sha256": sha,
                        "duplicate_file_name": original_name,
                        "canonical_case_id": duplicate_case["canonical_case_id"],
                    },
                    metadata={
                        "size_bytes": len(content),
                        "content_type": file.content_type,
                        "deduplication": "sha256_exact_match",
                    },
                    correlation_id=x_correlation_id,
                )
            else:
                conn.execute(
                    """INSERT INTO ap_cases
                    (id, file_name, stored_path, sha256, status, created_by, review_reason,
                     extracted_fields_json, line_items_json, validation_json, confirmed_checks_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 'RECEIVED', ?, NULL, '{}', '[]', '{}', '[]', ?, ?)""",
                    (
                        case_id,
                        original_name,
                        str(stored_path),
                        sha,
                        actor.user_id,
                        now,
                        now,
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO document_claims
                        (sha256, canonical_case_id, first_seen_at, last_seen_at, duplicate_count)
                    VALUES (?, ?, ?, ?, 0)
                    """,
                    (sha, case_id, now, now),
                )
                audit_event(
                    conn,
                    case_id,
                    "CASE_UPLOADED",
                    actor,
                    reason="Invoice uploaded",
                    after={
                        "status": "RECEIVED",
                        "file_name": original_name,
                        "sha256": sha,
                    },
                    metadata={
                        "size_bytes": len(content),
                        "content_type": file.content_type,
                        "deduplication": "new_sha256",
                    },
                    correlation_id=x_correlation_id,
                )
    except Exception:
        stored_path.unlink(missing_ok=True)
        raise

    if duplicate_case is not None:
        # Do not retain a second physical copy for an exact duplicate.
        stored_path.unlink(missing_ok=True)
        canonical_id = duplicate_case["canonical_case_id"]
        with connect() as conn:
            canonical_row = conn.execute(
                "SELECT * FROM ap_cases WHERE id = ?", (canonical_id,)
            ).fetchone()
            visible = canonical_row is not None and can_view(actor, canonical_row)

        if not visible:
            raise HTTPException(
                status_code=409,
                detail="This file matches an existing invoice record. No new case was created; ask an AP administrator to locate the existing case.",
            )

        return JSONResponse(
            status_code=200,
            content={
                "case_id": canonical_id,
                "status": duplicate_case["status"],
                "file_name": duplicate_case["file_name"],
                "duplicate": True,
                "duplicate_type": "EXACT_FILE",
                "message": "This exact file was already uploaded. The existing case was returned; no new case or processing job was created.",
            },
        )
    background_tasks.add_task(process_case, case_id)
    return {
        "case_id": case_id,
        "status": "RECEIVED",
        "file_name": original_name,
        "duplicate": False,
        "message": "Accepted. Poll the case endpoint for processing status.",
    }


@router.get("")
def list_cases(
    status_filter: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None, min_length=1, max_length=100),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    actor: Actor = Depends(get_actor),
) -> dict[str, Any]:
    """
    List AP cases for the dashboard and manual-review worklist.

    Examples:
      GET /api/v1/cases
      GET /api/v1/cases?status=NEEDS_REVIEW
      GET /api/v1/cases?status=NEEDS_REVIEW&search=INV-1001
      GET /api/v1/cases?status=NEEDS_REVIEW&limit=50&offset=0
    """
    conditions: list[str] = []
    params: list[Any] = []

    if status_filter:
        conditions.append("UPPER(status) = ?")
        params.append(status_filter.strip().upper())

    if search:
        conditions.append("file_name LIKE ?")
        params.append(f"%{search.strip()}%")

    where_sql = " WHERE " + " AND ".join(conditions) if conditions else ""

    with connect() as conn:
        # Fetch complete rows because row_to_case() expects all fields.
        rows = conn.execute(
            f"""
            SELECT *
            FROM ap_cases
            {where_sql}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
            """,
            (*params, limit, offset),
        ).fetchall()

        items = [row_to_case(row) for row in rows if can_view(actor, row)]

        # Count matches using the same filters, not all database records.
        total_row = conn.execute(
            f"""
            SELECT COUNT(*) AS total
            FROM ap_cases
            {where_sql}
            """,
            params,
        ).fetchone()
        total = total_row["total"]

    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{case_id}")
def get_case(case_id: str, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    with connect() as conn:
        row = case_or_404(conn, case_id)
        if not can_view(actor, row):
            raise HTTPException(status_code=403, detail="You cannot view this case")
        item = row_to_case(row)
        item["possible_duplicate_cases"] = json_load(row["validation_json"], {}).get(
            "possible_duplicates", []
        )
        return item


@router.get("/{case_id}/document")
def get_document(case_id: str, actor: Actor = Depends(get_actor)):
    with connect() as conn:
        row = case_or_404(conn, case_id)
        if not can_view(actor, row):
            raise HTTPException(status_code=403, detail="You cannot view this document")
        path = Path(row["stored_path"])
        name = row["file_name"]
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Stored document not found")
    media_type = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(
        path, media_type=media_type, filename=name, content_disposition_type="inline"
    )


@router.patch("/{case_id}/fields")
def correct_fields(
    case_id: str,
    body: FieldCorrection,
    actor: Actor = Depends(require_roles("AP_PROCESSOR", "ADMIN")),
    x_correlation_id: str | None = Header(default=None),
) -> dict[str, Any]:
    unknown = set(body.fields) - ALLOWED_EDIT_FIELDS
    if unknown:
        raise HTTPException(
            status_code=422,
            detail={"message": "Unsupported fields", "fields": sorted(unknown)},
        )
    if not body.fields:
        raise HTTPException(
            status_code=422, detail="At least one field correction is required"
        )
    with transaction() as conn:
        row = case_or_404(conn, case_id)
        if row["status"] not in {"NEEDS_REVIEW", "RETURNED", "PROCESSING_ERROR"}:
            raise HTTPException(
                status_code=409,
                detail=f"Fields cannot be edited while case is {row['status']}",
            )
        old_fields = json_load(row["extracted_fields_json"], {})
        merged = dict(old_fields)
        before_values = {}
        after_values = {}
        for key, value in body.fields.items():
            old_value = row[key] if key in row.keys() else old_fields.get(key)
            value = normalize_field_value(key, value)
            merged[key] = value
            before_values[key] = old_value
            after_values[key] = value
        assignments = [f"{key}=?" for key in body.fields]
        params = [merged.get(key) for key in body.fields]
        validation = json_load(row["validation_json"], {})
        # Corrections can resolve extraction-missing flags, but do not silently pass other business checks.
        corrected_names = set(body.fields)
        validation["missing_fields"] = [
            name
            for name in validation.get("missing_fields", [])
            if name not in corrected_names
        ]
        conn.execute(
            f"UPDATE ap_cases SET {', '.join(assignments)}, extracted_fields_json=?, validation_json=?, last_edited_by=?, updated_at=?, version=version+1 WHERE id=?",
            (
                *params,
                json_dump(merged),
                json_dump(validation),
                actor.user_id,
                utc_now(),
                case_id,
            ),
        )
        audit_event(
            conn,
            case_id,
            "FIELDS_CORRECTED",
            actor,
            reason=body.comment,
            before=before_values,
            after=after_values,
            metadata={"changed_fields": list(body.fields)},
            correlation_id=x_correlation_id,
        )
        fresh = case_or_404(conn, case_id)
        return row_to_case(fresh)


@router.get("/{case_id}/history")
def case_history(case_id: str, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    with connect() as conn:
        row = case_or_404(conn, case_id)
        if not can_view(actor, row):
            raise HTTPException(
                status_code=403, detail="You cannot view this case history"
            )
        events = conn.execute(
            "SELECT * FROM audit_events WHERE case_id=? ORDER BY created_at ASC",
            (case_id,),
        ).fetchall()
        decisions = conn.execute(
            "SELECT * FROM approval_decisions WHERE case_id=? ORDER BY created_at ASC",
            (case_id,),
        ).fetchall()
    return {
        "case_id": case_id,
        "events": [
            {
                **dict(e),
                "before": json_load(e["before_json"], None),
                "after": json_load(e["after_json"], None),
                "metadata": json_load(e["metadata_json"], {}),
            }
            for e in events
        ],
        "decisions": [dict(d) for d in decisions],
    }
