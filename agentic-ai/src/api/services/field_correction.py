from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException


def normalize_field_value(key: str, value: Any) -> Any:
    """Validate and normalize a single corrected field value."""
    if key == "total_amount" and value not in (None, ""):
        try:
            value = str(Decimal(str(value)))
        except (InvalidOperation, ValueError):
            raise HTTPException(
                status_code=422,
                detail="total_amount must be a valid decimal number",
            )
        if Decimal(value) < 0:
            raise HTTPException(
                status_code=422, detail="total_amount cannot be negative"
            )
    if key == "currency" and value:
        value = str(value).upper().strip()
        if len(value) != 3:
            raise HTTPException(
                status_code=422, detail="currency must be a 3-letter code"
            )
    return value
