from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, Query

from ..auth import require_roles
from ..database import connect, row_to_case
from ..schemas import Actor, DecisionRequest
from ..services.decisions import decide

router = APIRouter(prefix="/api/v1")

APPROVER_ROLES = ("AP_APPROVER", "FINANCE_MANAGER")


@router.get("/approvals")
def approval_queue(
    status_filter: str = Query(default="PENDING", alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    actor: Actor = Depends(require_roles(*APPROVER_ROLES, "ADMIN")),
) -> dict[str, Any]:
    with connect() as conn:
        rows = conn.execute(
            """SELECT ar.id AS approval_request_id, ar.stage, ar.status AS approval_status,
            ar.assigned_approver_id, ar.created_at AS requested_at, c.*
            FROM approval_requests ar JOIN ap_cases c ON c.id=ar.case_id
            WHERE ar.status=? AND c.status='PENDING_APPROVAL'
            ORDER BY ar.created_at ASC LIMIT ? OFFSET ?""",
            (status_filter.upper(), limit, offset),
        ).fetchall()
        items = []
        for row in rows:
            if (
                row["assigned_approver_id"]
                and row["assigned_approver_id"] != actor.user_id
                and actor.role != "ADMIN"
            ):
                continue
            case = row_to_case(row)
            case.update(
                {
                    "approval_request_id": row["approval_request_id"],
                    "approval_stage": row["stage"],
                    "approval_status": row["approval_status"],
                    "requested_at": row["requested_at"],
                }
            )
            items.append(case)
        total = conn.execute(
            "SELECT COUNT(*) FROM approval_requests WHERE status=?",
            (status_filter.upper(),),
        ).fetchone()[0]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.post("/cases/{case_id}/approve")
def approve_case(
    case_id: str,
    body: DecisionRequest,
    actor: Actor = Depends(require_roles(*APPROVER_ROLES)),
    x_correlation_id: str | None = Header(default=None),
) -> dict[str, Any]:
    return decide(case_id, body, actor, "APPROVE", x_correlation_id)


@router.post("/cases/{case_id}/return")
def return_case(
    case_id: str,
    body: DecisionRequest,
    actor: Actor = Depends(require_roles(*APPROVER_ROLES)),
    x_correlation_id: str | None = Header(default=None),
) -> dict[str, Any]:
    return decide(case_id, body, actor, "RETURN", x_correlation_id)


@router.post("/cases/{case_id}/reject")
def reject_case(
    case_id: str,
    body: DecisionRequest,
    actor: Actor = Depends(require_roles(*APPROVER_ROLES)),
    x_correlation_id: str | None = Header(default=None),
) -> dict[str, Any]:
    return decide(case_id, body, actor, "REJECT", x_correlation_id)
