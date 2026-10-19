ALLOWED_EDIT_FIELDS = {
    "invoice_number",
    "supplier_name",
    "supplier_id",
    "company_code",
    "currency",
    "total_amount",
    "invoice_date",
    "po_number",
    "document_type",
    "invoice_type",
}

REQUIRED_INVOICE_FIELDS = (
    "invoice_number",
    "supplier_name",
    "currency",
    "total_amount",
)

REQUIRED_REVIEW_CHECKS = {"vendor", "tax", "duplicate"}

# Statuses each role may see (besides ADMIN and the case creator).
APPROVER_VISIBLE_STATUSES = {
    "NEEDS_REVIEW",
    "RETURNED",
    "PENDING_APPROVAL",
    "APPROVED",
    "REJECTED",
    "POSTING",
    "POSTED",
    "POSTING_ERROR",
}
PROCESSOR_VISIBLE_STATUSES = {
    "NEEDS_REVIEW",
    "RETURNED",
    "PROCESSING_ERROR",
    "APPROVED",
    "REJECTED",
    "POSTING",
    "POSTED",
    "POSTING_ERROR",
}
