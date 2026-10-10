from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from .enums import Action, CaseStatus, InvoiceField, RecommendationSource

Text = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
Money = Annotated[Decimal, Field(ge=0, max_digits=18, decimal_places=2)]
Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AgentModel(BaseModel):
    """Agent replies may carry fields this backend does not use."""

    model_config = ConfigDict(extra="ignore")


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


class RuleResult(AgentModel):
    code: str
    passed: bool = Field(strict=True)
    evidence: str


class Recommendation(Model):
    action: Action
    reason: str = Field(min_length=1)
    source: RecommendationSource
    amount: Money | None = None
    evidence: list[str] = Field(default_factory=list)
    confidence: float | None = Field(default=None, ge=0, le=1)


class ConfirmRequest(Model):
    action: Action
    reason: Text


class AgentCase(Model):
    case_id: str
    vendor: str
    inv_no: str
    po: str
    net: Decimal
    vat: Decimal
    gross: Decimal
    currency: str
    rules_version: str
    rules: list[dict[str, object]]


class AgentRequest(Model):
    case: AgentCase
    token: str


class AgentFinding(AgentModel):
    action: Action
    amount: Money | None = None
    summary: str = Field(min_length=1)
    evidence: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    rule_results: list[RuleResult] = Field(default_factory=list)


class AgentReport(AgentModel):
    final: AgentFinding | None = None
    trace: list[str] = Field(default_factory=list)
    steps: int = 0
    error: str | None = None


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


class PoChange(Model):
    date: date
    note: str


class GoodsReceiptPosting(Model):
    date: date
    amount: Money


class DeliveryNote(Model):
    date: date
    note: str


class GoodsReceiptDetail(Model):
    posted: list[GoodsReceiptPosting]
    delivery_notes: list[DeliveryNote]


class VendorHistoryEntry(Model):
    inv_no: str
    variance: str
    reason: str


class ToolPurchaseOrder(Model):
    po: str
    vendor: str
    amount: Money
    currency: Currency
    gr_total: Money | None
    change_log: list[PoChange]


class SimilarCase(Model):
    inv_no: str
    status: CaseStatus


class DuplicateCheck(Model):
    in_sap: bool
    in_open_case: bool


class ToolClaims(Model):
    jti: str
    case_id: str
    po: str
    vendor: str
    invoice_number: str
    exp: int


class ToolResponse(Model):
    result: object


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
