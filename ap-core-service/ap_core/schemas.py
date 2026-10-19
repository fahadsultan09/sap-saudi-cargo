from __future__ import annotations
from pydantic import BaseModel, Field, ConfigDict
from typing import Any, Literal

class RegisterUpload(BaseModel):
    source: str = Field(default="ui5", min_length=1, max_length=80)
    file_name: str = Field(min_length=1, max_length=255)
    sha256: str = Field(pattern=r"^[a-fA-F0-9]{64}$")
    document_ref: str | None = Field(default=None, max_length=1000)
    created_by: str = Field(default="system", min_length=1, max_length=200)
    correlation_id: str | None = None

class AgentResult(BaseModel):
    agent_name: str = Field(min_length=1, max_length=100)
    judgement_type: str = Field(min_length=1, max_length=100)
    payload: dict[str, Any]
    model_version: str | None = None
    idempotency_key: str = Field(min_length=8, max_length=200)
    correlation_id: str | None = None

class ExtractionResult(BaseModel):
    fields: dict[str, Any]
    validation: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = Field(min_length=8, max_length=200)
    correlation_id: str | None = None

class ProgressUpdate(BaseModel):
    """Live agent progress while a case is processing: the finished steps and SAP data checks so far."""
    agent_trace: list[dict[str, Any]] = Field(default_factory=list)
    source_checks: list[dict[str, Any]] = Field(default_factory=list)

class LeaseRequest(BaseModel):
    worker_id: str = Field(min_length=1, max_length=200)
    task_types: list[str] = Field(default_factory=lambda: ["PROCESS_DOCUMENT"])
    lease_seconds: int = Field(default=120, ge=10, le=900)

class WorkCompletion(BaseModel):
    worker_id: str
    outcome: Literal["SUCCEEDED", "RETRY", "FAILED"]
    result: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    idempotency_key: str = Field(min_length=8, max_length=200)

class TransitionRequest(BaseModel):
    target_status: str
    actor: str = Field(min_length=1, max_length=200)
    reason: str = Field(default="", max_length=2000)
    expected_version: int | None = None
    idempotency_key: str = Field(min_length=8, max_length=200)
    decision_class: Literal["HUMAN_DECISION", "SYSTEM_ACTION"] = "SYSTEM_ACTION"
    payload: dict[str, Any] = Field(default_factory=dict)

class Health(BaseModel):
    status: str
    service: str
    version: str

class Actor(BaseModel):
    """The signed-in person, resolved by the gateway from a verified login token."""
    user_id: str
    role: str

EDITABLE_FIELDS = Literal["supplier_name", "supplier_id", "invoice_number", "invoice_date", "po_number", "currency", "total_amount", "company_code"]

class FieldCorrection(BaseModel):
    fields: dict[EDITABLE_FIELDS, str | None] = Field(min_length=1)
    comment: str = Field(min_length=3, max_length=2000)

class Decision(BaseModel):
    # Optional to approve; returning or rejecting needs a reason (checked in the decision endpoint).
    comment: str = Field(default="", max_length=2000)
