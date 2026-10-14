from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

Role = Literal["AP_PROCESSOR", "AP_APPROVER", "FINANCE_MANAGER", "ADMIN"]


class Actor(BaseModel):
    user_id: str = Field(min_length=1, max_length=160)
    role: Role
    email: str | None = None


class CaseSummary(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    status: str
    file_name: str
    supplier_name: str | None = None
    invoice_number: str | None = None
    currency: str | None = None
    total_amount: str | None = None
    created_at: str
    updated_at: str


class FieldCorrection(BaseModel):
    fields: dict[str, Any]
    comment: str = Field(min_length=3, max_length=2000)


class SubmitForApproval(BaseModel):
    comment: str = Field(min_length=3, max_length=2000)
    confirmed_checks: list[Literal["vendor", "po", "tax", "duplicate"]] = Field(default_factory=list)


class DecisionRequest(BaseModel):
    comment: str = Field(min_length=3, max_length=2000)


class HealthResponse(BaseModel):
    status: str
    service: str
    auth_mode: str
