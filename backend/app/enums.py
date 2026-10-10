from __future__ import annotations

from enum import StrEnum


class CaseStatus(StrEnum):
    RECEIVED = "RECEIVED"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    EXTRACTED = "EXTRACTED"
    WAITING_EXTERNAL = "WAITING_EXTERNAL"
    AWAITING_CONFIRM = "AWAITING_CONFIRM"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    READY_TO_POST = "READY_TO_POST"
    POSTING = "POSTING"
    POST_UNKNOWN = "POST_UNKNOWN"
    POST_FAILED = "POST_FAILED"
    POSTED = "POSTED"
    RECONCILIATION_FAILED = "RECONCILIATION_FAILED"
    RECONCILED = "RECONCILED"
    INFORMED = "INFORMED"
    REJECTED = "REJECTED"


class Action(StrEnum):
    POST = "POST"
    HOLD = "HOLD"
    REJECT = "REJECT"


class InvoiceField(StrEnum):
    VENDOR = "vendor"
    INVOICE_NUMBER = "invoice_number"
    PO_NUMBER = "po_number"
    NET = "net"
    VAT = "vat"
    CURRENCY = "currency"


class RecommendationSource(StrEnum):
    AGENT = "agent"
    MANUAL = "manual"


class ToolName(StrEnum):
    GET_PO = "get_po"
    GET_GOODS_RECEIPTS = "get_goods_receipts"
    VENDOR_HISTORY = "vendor_history"
    FIND_SIMILAR_CASES = "find_similar_cases"
    GET_VENDOR = "get_vendor"
    CHECK_DUPLICATE = "check_duplicate"
