from __future__ import annotations

from decimal import Decimal, InvalidOperation

from fastapi import HTTPException

from ..config import APPROVER_MAX_AMOUNT
from ..schemas import Actor


def assert_approvable(actor: Actor, row) -> None:
    if actor.role not in {"AP_APPROVER", "FINANCE_MANAGER"}:
        raise HTTPException(
            status_code=403, detail="Only authorized finance approvers can decide"
        )
    if row["created_by"] == actor.user_id or (
        row["last_edited_by"] and row["last_edited_by"] == actor.user_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Segregation of duties: preparer/editor cannot approve their own invoice",
        )
    try:
        amount = Decimal(str(row["total_amount"] or "0"))
        max_amount = Decimal(APPROVER_MAX_AMOUNT)
    except InvalidOperation as exc:
        raise HTTPException(
            status_code=422, detail="Invoice amount or approval limit is invalid"
        ) from exc
    if actor.role == "AP_APPROVER" and amount > max_amount:
        raise HTTPException(
            status_code=403,
            detail="Invoice amount exceeds your approval limit; finance manager approval is required",
        )
