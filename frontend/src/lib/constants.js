export const PROCESSING = ["RECEIVED", "PROCESSING"];
export const NEEDS_ATTENTION = [
  "NEEDS_REVIEW",
  "RETURNED",
  "PROCESSING_ERROR",
  "READY_FOR_APPROVAL",
  "PENDING_APPROVAL",
];
export const APPROVED = ["APPROVED", "POSTING", "POSTED", "POSTING_ERROR"];
export const EDITABLE = ["NEEDS_REVIEW", "RETURNED", "PROCESSING_ERROR"];
export const DECIDABLE = ["NEEDS_REVIEW", "RETURNED"];

export const STATUS_PLAIN = {
  RECEIVED: "Working",
  PROCESSING: "Working",
  NEEDS_REVIEW: "Needs review",
  READY_FOR_APPROVAL: "Needs review",
  PENDING_APPROVAL: "Needs review",
  PROCESSING_ERROR: "Needs review",
  RETURNED: "Needs review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  POSTING: "Approved",
  POSTED: "Approved",
  POSTING_ERROR: "Approved",
};

export const OUTCOME_TONE = {
  Working: "working",
  "Needs review": "review",
  Approved: "approved",
  Rejected: "rejected",
};

export const FIELDS = [
  { key: "supplier_name", label: "Supplier", required: true },
  { key: "supplier_id", label: "Supplier ID" },
  { key: "invoice_number", label: "Invoice number", required: true },
  { key: "invoice_date", label: "Invoice date" },
  { key: "po_number", label: "PO number" },
  { key: "currency", label: "Currency", required: true },
  { key: "total_amount", label: "Total amount", required: true },
  { key: "company_code", label: "Company code" },
];

/** Plain-English process steps. Agent ids stay internal; never show TOWER/LENS on main UI. */
export const PROCESS_STEPS = [
  {
    key: "receive",
    title: "Got your file",
    plain: "Opening a case for this invoice",
    role: "Intake",
    glyph: "↓",
  },
  {
    key: "classify",
    title: "Reading invoice",
    plain: "Confirming this is an invoice",
    agent: "TOWER",
    role: "Document type",
    glyph: "◈",
  },
  {
    key: "extract",
    title: "Pulling out details",
    plain: "Supplier, amounts, dates, PO",
    agent: "LENS",
    role: "Field extraction",
    glyph: "◎",
  },
  {
    key: "finance",
    title: "Checking numbers",
    plain: "Vendor, tax, and duplicate checks",
    agent: "FINANCE_RULES",
    role: "Rules & risk",
    glyph: "▣",
  },
  {
    key: "decide",
    title: "Ready for you",
    plain: "Your turn to review and decide",
    role: "Human",
    glyph: "✦",
  },
];

export const NOW_LABELS = {
  receive: "Receiving your file…",
  classify: "Reading invoice…",
  extract: "Pulling out details…",
  finance: "Checking numbers…",
  decide: "Ready for you…",
};

export const REVIEW_REASONS = {
  MANUAL_MODE_ENABLED: "Every invoice is checked by a person before approval.",
  UNSUPPORTED_DOCUMENT_TYPE: "This may not be an invoice or credit note.",
  INVALID_CONFIDENCE: "We could not tell what type of document this is.",
  LOW_CONFIDENCE: "We are not sure what type of document this is.",
  MISSING_REQUIRED_FIELDS: "Some required invoice details are missing.",
  LOW_CRITICAL_FIELD_CONFIDENCE: "Key details should be checked against the PDF.",
  VALIDATION_FAILED: "Some finance checks did not pass.",
  DUPLICATE_CHECK_FAILED: "This invoice may already have been submitted.",
};

export const POLL_MS = 1500;
export const LIST_REFRESH_MS = 3000;
export const UPLOAD_WATCH_MIN_MS = 4200;
