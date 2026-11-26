"""Business-friendly messages for the errors AP Core returns.

AP Core answers with technical FastAPI errors ({"detail": ...}). The gateway logs those for
developers and shows the users the plain-language message of the first matching rule below.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class FriendlyError:
    code: str
    message: str


STATUS_LABELS = {
    "RECEIVED": "Received",
    "PROCESSING": "Agents processing",
    "NEEDS_REVIEW": "Needs Review",
    "READY_FOR_APPROVAL": "Ready for Approval",
    "PENDING_APPROVAL": "Pending Approval",
    "PROCESSING_ERROR": "Processing Error",
    "RETURNED": "Returned",
    "APPROVED": "Approved",
    "REJECTED": "Rejected",
    "POSTING": "Posting",
    "POSTED": "Posted",
    "POSTING_ERROR": "Posting Error",
}

# (HTTP status, pattern in AP Core's message, code, message). Named groups of the pattern and
# {status} (the case status of a refused state change) can be used in the message.
RULES: list[tuple[int, str, str, str]] = [
    (403, r"Your role does not allow", "not_permitted",
     "Your role does not allow this action."),
    (403, r"Approval must be independent", "own_invoice",
     "You cannot approve an invoice you uploaded or corrected. Another approver must review it."),
    (404, r"Case not found", "case_not_found",
     "This invoice could not be found. It may have been removed."),
    (404, r"Stored document not found", "document_not_found",
     "The original invoice file is no longer available."),
    (409, r"VERSION_CONFLICT", "changed_meanwhile",
     "Someone else changed this invoice in the meantime. Refresh the page and try again."),
    (409, r"INVALID_TRANSITION", "not_possible_now",
     "This action is not possible while the invoice is {status}."),
    (413, r"exceeds the (?P<size>\d+) MiB", "file_too_large",
     "The file is too large. Invoices can be up to {size} MB."),
    (415, r"Only PDF invoices", "unsupported_file",
     "Only PDF invoices can be uploaded. Please save the invoice as a PDF and try again."),
    (415, r"valid PDF signature", "damaged_file",
     "The file is not a valid PDF. It may be damaged or renamed; "
     "please upload the original invoice."),
    (422, r"comment of at least 3 characters", "comment_required",
     "Please enter a reason of at least 3 characters to return or reject this invoice."),
    (422, r"Total amount must be a number", "invalid_amount",
     "Total amount must be a number, for example 1250.00."),
    (422, r"Total amount must be zero or more", "negative_amount",
     "Total amount cannot be negative."),
    (422, r"Currency must be a 3-letter code", "invalid_currency",
     "Currency must be a 3-letter code, for example SAR or USD."),
]

FALLBACKS = {
    400: FriendlyError("bad_request", "The request could not be processed. Please try again."),
    401: FriendlyError(
        "not_signed_in", "Your sign-in could not be confirmed. Please sign in again."
    ),
    403: FriendlyError("not_permitted", "You are not allowed to perform this action."),
    404: FriendlyError("not_found", "The requested item could not be found."),
    409: FriendlyError(
        "conflict", "This action is not possible in the invoice's current status. "
        "Refresh the page and try again."
    ),
    413: FriendlyError("file_too_large", "The file is too large to upload."),
    415: FriendlyError(
        "unsupported_file", "This file type is not supported. Please upload a PDF."
    ),
    422: FriendlyError(
        "invalid_input",
        "Some of the information entered is not valid. Please check it and try again.",
    ),
}
SERVICE_ERROR = FriendlyError(
    "service_error",
    "The invoice service ran into a problem. Please try again in a moment; "
    "if it keeps happening, contact IT support.",
)
COMMENT_REQUIRED = FriendlyError(
    "comment_required", "Please enter a comment of at least 3 characters."
)


def translate(status: int, body: object) -> FriendlyError:
    """Turn an AP Core error response into the message shown to business users."""
    if status >= 500:
        return SERVICE_ERROR
    detail = body.get("detail") if isinstance(body, dict) else None
    # FastAPI request validation: a list of {loc, msg}; the only free-text input is the comment.
    if isinstance(detail, list):
        if any("comment" in item.get("loc", []) for item in detail if isinstance(item, dict)):
            return COMMENT_REQUIRED
        return FALLBACKS[422]
    case_status = ""
    # A refused state change: {"code": "INVALID_TRANSITION", "from": <status>, ...}.
    if isinstance(detail, dict):
        case_status = str(detail.get("from") or detail.get("current_status") or "")
        detail = detail.get("code")
    text = str(detail or "")
    for rule_status, pattern, code, message in RULES:
        match = re.search(pattern, text)
        if rule_status == status and match:
            label = STATUS_LABELS.get(case_status, case_status)
            return FriendlyError(code, message.format(status=label, **match.groupdict()))
    return FALLBACKS.get(status, FALLBACKS[400])
