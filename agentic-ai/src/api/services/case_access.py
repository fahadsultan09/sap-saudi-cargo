from __future__ import annotations

from fastapi import HTTPException

from ..constants import (
    APPROVER_VISIBLE_STATUSES,
    PROCESSOR_VISIBLE_STATUSES,
    REQUIRED_INVOICE_FIELDS,
)
from ..database import json_load
from ..schemas import Actor


def case_or_404(conn, case_id: str):
    row = conn.execute("SELECT * FROM ap_cases WHERE id = ?", (case_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return row


def can_view(actor: Actor, row) -> bool:
    if actor.role == "ADMIN" or row["created_by"] == actor.user_id:
        return True

    if actor.role in {"AP_APPROVER", "FINANCE_MANAGER"}:
        return row["status"] in APPROVER_VISIBLE_STATUSES

    return actor.role == "AP_PROCESSOR" and row["status"] in PROCESSOR_VISIBLE_STATUSES


def required_fields_missing(row) -> list[str]:
    fields = json_load(row["extracted_fields_json"], {})
    values = {
        "invoice_number": row["invoice_number"] or fields.get("invoice_number"),
        "supplier_name": row["supplier_name"] or fields.get("supplier_name"),
        "currency": row["currency"] or fields.get("currency"),
        "total_amount": row["total_amount"] or fields.get("total_amount"),
    }
    return [
        name for name in REQUIRED_INVOICE_FIELDS if values.get(name) in (None, "", [])
    ]
