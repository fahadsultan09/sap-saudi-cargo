from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException

from ..database import json_load, transaction, utc_now
from ..schemas import Actor, DecisionRequest
from .approval_rules import assert_approvable
from .audit_helper import audit_event
from .case_access import case_or_404, required_fields_missing

POLICY_VERSION = "poc-v1"

NEW_STATUS = {
    "APPROVE": "APPROVED",
    "RETURN": "RETURNED",
    "REJECT": "REJECTED",
}


def _already_decided_message(current_status: str) -> str:
    if current_status == "APPROVED":
        return "This case has already been approved. You cannot approve or reject it again."
    if current_status == "REJECTED":
        return "This case has already been rejected. You cannot approve or reject it again."
    return (
        f"This case cannot be approved or rejected because "
        f"its current status is {current_status}."
    )


def decide(
    case_id: str,
    body: DecisionRequest,
    actor: Actor,
    decision: str,
    x_correlation_id: str | None = None,
) -> dict[str, Any]:
    with transaction() as conn:
        row = case_or_404(conn, case_id)

        if row["status"] not in {"NEEDS_REVIEW", "RETURNED"}:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": _already_decided_message(row["status"]),
                    "case_id": case_id,
                    "current_status": row["status"],
                },
            )

        assert_approvable(actor, row)

        if decision == "APPROVE":
            missing = required_fields_missing(row)
            if missing:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "message": "Required invoice fields are missing",
                        "fields": missing,
                    },
                )
            validation = json_load(row["validation_json"], {})
            missing_from_triage = validation.get("missing_fields", [])
            if missing_from_triage:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "message": "Resolve triage missing fields before approval",
                        "fields": missing_from_triage,
                    },
                )

        before = {"case_status": row["status"]}
        now = utc_now()
        new_status = NEW_STATUS[decision]

        # Record the decision directly, without an approval request.
        conn.execute(
            """
            INSERT INTO approval_decisions (
                id, approval_request_id, case_id, decision,
                actor_id, actor_role, comment, policy_version, created_at
            )
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                case_id,
                decision,
                actor.user_id,
                actor.role,
                body.comment,
                POLICY_VERSION,
                now,
            ),
        )

        conn.execute(
            """
            UPDATE ap_cases
            SET status=?, review_reason=?, updated_at=?, version=version+1
            WHERE id=?
            """,
            (
                new_status,
                body.comment if decision != "APPROVE" else None,
                now,
                case_id,
            ),
        )

        audit_event(
            conn,
            case_id,
            f"APPROVAL_{decision}D" if decision != "RETURN" else "APPROVAL_RETURNED",
            actor,
            reason=body.comment,
            before=before,
            after={"case_status": new_status, "decision": decision},
            metadata={
                "approval_request_id": None,
                "policy_version": POLICY_VERSION,
                "decision_mode": "direct",
            },
            correlation_id=x_correlation_id,
        )

        if decision == "APPROVE":
            _record_posting_placeholder(
                conn, case_id, row["company_code"], actor, now, x_correlation_id
            )

        return {
            "case_id": case_id,
            "status": new_status,
            "decision": decision,
            "message": (
                "Approval recorded. SAP posting is not enabled by this POC."
                if decision == "APPROVE"
                else "Decision recorded."
            ),
        }


def _record_posting_placeholder(
    conn, case_id, company_code, actor, now, x_correlation_id
) -> None:
    """Placeholder only. This does not post to SAP."""
    idempotency_key = f"ap-case:{case_id}:posting:v1"
    conn.execute(
        """
        INSERT INTO posting_records (
            id, case_id, idempotency_key, status,
            company_code, created_at, updated_at
        )
        VALUES (?, ?, ?, 'NOT_CONFIGURED', ?, ?, ?)
        """,
        (str(uuid.uuid4()), case_id, idempotency_key, company_code, now, now),
    )
    audit_event(
        conn,
        case_id,
        "POSTING_WAITING_FOR_INTEGRATION",
        actor,
        reason="Approved. SAP posting adapter is not configured in this POC.",
        after={"posting_status": "NOT_CONFIGURED"},
        metadata={"idempotency_key": idempotency_key},
        correlation_id=x_correlation_id,
    )
