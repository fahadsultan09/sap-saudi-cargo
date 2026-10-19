"""Domain types and enums for the AP Invoice Triage Agent.

Contains all domain enums (DocumentType, InvoiceType), the
validated TriageResult model, and dataclasses (ExtractedField, LineItem) used
throughout the triage pipeline.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional, Literal

from pydantic import BaseModel, ConfigDict, Field


# -- Enums ------------------------------------------------------------------


class DocumentType(str, Enum):
    """Document type classification."""
    INVOICE = "INVOICE"
    CREDIT_NOTE = "CREDIT_NOTE"
    STATEMENT = "STATEMENT"
    SUPPORTING_DOCUMENT = "SUPPORTING_DOCUMENT"
    RECONCILIATION = "RECONCILIATION"
    PURCHASE_ORDER_LIST = "PURCHASE_ORDER_LIST"
    GENERAL_CORRESPONDENCE = "GENERAL_CORRESPONDENCE"
    OTHER = "OTHER"


class InvoiceType(str, Enum):
    """Invoice type classification."""
    FUEL = "FUEL"
    CARGO = "CARGO"
    CHARTER = "CHARTER"
    SERVICE = "SERVICE"
    OTHER = "OTHER"


# -- Dataclasses ------------------------------------------------------------


@dataclass
class ExtractedField:
    """A single extracted field with confidence score."""
    name: str
    value: Any
    confidence: float = 0.0
    raw_value: Optional[str] = None


@dataclass
class LineItem:
    """A line item extracted from the document."""
    item_number: str = ""
    description: str = ""
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    total_amount: Optional[float] = None
    gl_account: str = ""
    cost_center: str = ""
    tax_code: str = ""
    confidence: float = 0.0
    raw_data: dict[str, Any] = field(default_factory=dict)


class TriageResult(BaseModel):
    """Strict JSON TriageResult returned at the end of the workflow."""

    model_config = ConfigDict(use_enum_values=True)

    document_type: DocumentType
    invoice_type: InvoiceType
    extracted_header_fields: dict[str, Any] = Field(default_factory=dict)
    line_items: list[dict[str, Any]] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    evidence: list[str] = Field(default_factory=list)
    review_required: bool
    review_reason: Optional[str] = None
    missing_fields: list[str] = Field(default_factory=list)
    workflow_steps: list[WorkflowStep] = Field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2, default=str, ensure_ascii=False)



class WorkflowStep(BaseModel):
    """One step in the AP invoice workflow."""

    key: str
    title: str
    service: str = ""
    status: Literal["PASS", "INFO", "WARN", "SKIP", "ERROR"] = "INFO"
    headline: str = ""
    outcome: str = ""
    rules: list[str] = Field(default_factory=list)
    log: list[str] = Field(default_factory=list)
    lines: list[dict[str, Any]] = Field(default_factory=list)
