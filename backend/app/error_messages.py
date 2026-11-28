"""Business-friendly messages for the errors the agentic API returns.

The agentic API answers with technical FastAPI errors ({"detail": ...}). The gateway logs those for
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

FIELD_LABELS = {
    "supplier_name": "Supplier",
    "supplier_id": "Supplier ID",
    "invoice_number": "Invoice number",
    "invoice_date": "Invoice date",
    "po_number": "PO number",
    "currency": "Currency",
    "total_amount": "Total amount",
    "company_code": "Company code",
}

# (HTTP status, pattern in the agentic API's message, code, message). Named groups of the pattern
# and {fields} (the field list some errors carry) can be used in the message.
RULES: list[tuple[int, str, str, str]] = [
    (401, r"X-User-Id|Bearer token|access token", "not_signed_in",
     "Your sign-in could not be confirmed. Please sign in again."),
    (403, r"Insufficient role permissions", "not_permitted",
     "Your role does not allow this action."),
    (403, r"You cannot view this", "no_access",
     "You do not have access to this invoice."),
    (404, r"Case not found", "case_not_found",
     "This invoice could not be found. It may have been removed."),
    (404, r"Stored document not found", "document_not_found",
     "The original invoice file is no longer available."),
    (400, r"Uploaded file is empty", "empty_file",
     "The selected file is empty. Please choose the invoice file again."),
    (413, r"Maximum upload size is (?P<size>\d+) MB", "file_too_large",
     "The file is too large. Invoices can be up to {size} MB."),
    (415, r"Supported formats", "unsupported_file",
     "This file type is not supported. Please upload the invoice as a PDF, PNG or JPEG."),
    (415, r"does not look like a (?P<type>\w+)", "damaged_file",
     "The file is not a valid {type}. It may be damaged or renamed; "
     "please upload the original invoice."),
    (422, r"Unsupported fields", "field_not_editable",
     "These fields cannot be corrected: {fields}."),
    (422, r"At least one field correction is required", "no_changes",
     "Nothing was changed. Correct at least one field before saving."),
    (409, r"Fields cannot be edited while case is (?P<status>\w+)", "case_locked",
     "This invoice can no longer be corrected because its status is {status}."),
    (422, r"total_amount must be a valid decimal", "invalid_amount",
     "Total amount must be a number, for example 1250.00."),
    (422, r"total_amount cannot be negative", "negative_amount",
     "Total amount cannot be negative."),
    (422, r"currency must be a 3-letter code", "invalid_currency",
     "Currency must be a 3-letter code, for example SAR or USD."),
    (403, r"Only authorized finance approvers", "approver_only",
     "Only finance approvers can approve, return or reject invoices."),
    (403, r"Segregation of duties", "own_invoice",
     "You cannot decide on an invoice you uploaded or corrected. Another approver must review it."),
    (422, r"Invoice amount or approval limit is invalid", "amount_unknown",
     "The invoice total is missing or invalid, so it cannot be checked against your "
     "approval limit. Correct the total amount first."),
    (403, r"exceeds your approval limit", "above_limit",
     "This invoice is above your approval limit. A Finance Manager must approve it."),
    (409, r"Case cannot be decided from status (?P<status>\w+)", "not_decidable",
     "This invoice cannot be approved, returned or rejected because its status is {status}."),
    (422, r"Required invoice fields are missing", "missing_fields",
     "The invoice cannot be approved yet. Please fill in: {fields}."),
    (422, r"Resolve triage missing fields", "missing_fields",
     "The agents found missing information. Please complete {fields} before approving."),
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
        "unsupported_file", "This file type is not supported. Please upload a PDF, PNG or JPEG."
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
    """Turn an agentic API error response into the message shown to business users."""
    if status >= 500:
        return SERVICE_ERROR
    detail = body.get("detail") if isinstance(body, dict) else None
    # FastAPI request validation: a list of {loc, msg}; the only free-text input is the comment.
    if isinstance(detail, list):
        if any("comment" in item.get("loc", []) for item in detail if isinstance(item, dict)):
            return COMMENT_REQUIRED
        return FALLBACKS[422]
    fields: list[str] = []
    if isinstance(detail, dict):
        fields = [str(name) for name in detail.get("fields", [])]
        detail = detail.get("message")
    text = str(detail or "")
    for rule_status, pattern, code, message in RULES:
        match = re.search(pattern, text)
        if rule_status == status and match:
            values = {
                name: STATUS_LABELS.get(value, value) if name == "status" else value
                for name, value in match.groupdict().items()
            }
            values["fields"] = ", ".join(FIELD_LABELS.get(name, name) for name in fields)
            return FriendlyError(code, message.format(**values))
    return FALLBACKS.get(status, FALLBACKS[400])
