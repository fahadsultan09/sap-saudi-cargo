from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from .enums import Action, CaseStatus, InvoiceField

Text = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
Money = Annotated[Decimal, Field(ge=0, max_digits=18, decimal_places=2)]
Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Invoice(Model):
    vendor: Text
    invoice_number: Text
    po_number: Text
    net: Annotated[Decimal, Field(gt=0, max_digits=18, decimal_places=2)]
    vat: Money
    currency: Currency = "SAR"


class ExtractedField(Model):
    value: str | None = None
    confidence: float = Field(default=0, ge=0, le=1)


class ReviewRequest(Model):
    vendor: Text | None = None
    invoice_number: Text | None = None
    po_number: Text | None = None
    net: Annotated[Decimal, Field(gt=0, max_digits=18, decimal_places=2)] | None = None
    vat: Money | None = None
    currency: Currency | None = None


class RuleResult(Model):
    code: str
    passed: bool = Field(strict=True)
    evidence: str


class AgentRecommendation(Model):
    action: Action
    reason: str = Field(min_length=1, max_length=200)


class Recommendation(AgentRecommendation):
    source: Literal["agent"]


class AgentDecision(Model):
    results: list[RuleResult]
    recommendation: AgentRecommendation


class PostingPackage(Model):
    case_id: str
    invoice: Invoice
    gross: Money


class DocumentMetadata(Model):
    filename: str
    size: int
    sha256: str
    media_type: Literal["application/pdf"] = "application/pdf"


class Case(Model):
    id: str
    version: int = 0
    status: CaseStatus = CaseStatus.RECEIVED
    created_at: datetime
    updated_at: datetime
    fields: dict[InvoiceField, ExtractedField] = Field(default_factory=dict)
    invoice: Invoice | None = None
    document: DocumentMetadata | None = None
    rules: list[RuleResult] = Field(default_factory=list)
    rules_version: str | None = None
    recommendation: Recommendation | None = None
    confirmed_by: str | None = None
    approved_by: str | None = None
    package: PostingPackage | None = None
    package_hash: str | None = None
    idempotency_key: str | None = None
    sap_document_id: str | None = None
    reconciliation_differences: list[str] = Field(default_factory=list)
    notification_reference: str | None = None


class AuditEvent(Model):
    id: int
    case_id: str
    timestamp: datetime
    kind: str
    actor: str
    data: dict[str, object]


class CaseList(Model):
    items: list[Case]
    total: int
    limit: int
    offset: int


class Dashboard(Model):
    total: int
    counts: dict[CaseStatus, int]


class RejectRequest(Model):
    reason: Text


class InformRequest(Model):
    channel: Literal["email", "portal", "phone"]
    reference: Text


class PostRequest(Model):
    package_hash: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
    idempotency_key: Annotated[
        str,
        StringConstraints(min_length=16, max_length=128, pattern=r"^[A-Za-z0-9_-]+$"),
    ]


class PurchaseOrder(Model):
    number: str
    vendor: str
    gross: Money
    currency: Currency
    goods_receipt_gross: Money | None


class Vendor(Model):
    id: str
    active: bool


class GoodsReceipts(Model):
    gross: Money


class SapFacts(Model):
    purchase_order: PurchaseOrder | None
    goods_receipts: GoodsReceipts | None
    vendor: Vendor | None
    duplicate_in_sap: bool
    duplicate_in_open_case: bool


class SapDocument(Model):
    id: str
    package: PostingPackage


class Health(Model):
    status: Literal["ok"] = "ok"


class ErrorDetail(Model):
    code: str
    message: str
    details: list[dict[str, object]] = Field(default_factory=list)


class ErrorResponse(Model):
    error: ErrorDetail
