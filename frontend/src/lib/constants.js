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
/** Statuses the agentic API accepts for approve / return / reject. */
export const DECIDABLE = ["NEEDS_REVIEW", "RETURNED"];

/** KPI / board filter groups (aligned with backend-abdulahad dashboard). */
export const CASE_GROUPS = [
  { key: "processing", label: "In progress", statuses: PROCESSING, tone: "working" },
  { key: "review", label: "Needs review", statuses: NEEDS_ATTENTION, tone: "review" },
  { key: "awaiting", label: "Awaiting decision", statuses: DECIDABLE, tone: "review" },
  { key: "approved", label: "Approved", statuses: APPROVED, tone: "approved" },
  { key: "rejected", label: "Rejected", statuses: ["REJECTED"], tone: "rejected" },
];

export const CASES_PER_PAGE = 10;

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

/** Plain agent names on the runway; soft codenames are secondary UI only. */
export const PROCESS_STEPS = [
  {
    key: "receive",
    title: "Got your file",
    plain: "Opening a case for this invoice",
    detail:
      "ClearDesk accepts the upload, opens a case, and queues the agent line so the rest of the runway can start.",
    does: ["Accept the PDF", "Create a case", "Queue the next agents"],
    outcome: "File received and queued",
    role: "Intake",
    glyph: "↓",
  },
  {
    key: "classify",
    title: "Classifier",
    plain: "Confirming this is an invoice",
    detail:
      "Looks at page layout and content to confirm the file is an invoice (or credit note) before fields are read.",
    does: ["Open the document", "Scan layout", "Confirm document type"],
    outcome: "Confirmed as an invoice",
    agent: "TOWER",
    codename: "Tower",
    role: "Document type",
    glyph: "◈",
  },
  {
    key: "extract",
    title: "Document reader",
    plain: "Supplier, amounts, dates, PO",
    detail:
      "Pulls the details finance needs — supplier, invoice number, dates, amounts, currency, and PO — from the PDF.",
    does: ["Find supplier", "Read invoice number", "Pull dates and amounts", "Capture PO and currency"],
    outcome: "Key fields pulled from the PDF",
    agent: "LENS",
    codename: "Lens",
    role: "Field extraction",
    glyph: "◎",
  },
  {
    key: "finance",
    title: "Finance check",
    plain: "Vendor, tax, and duplicate checks",
    detail:
      "Runs vendor matching, total and tax checks, and a duplicate scan so risky invoices surface for a person.",
    does: ["Match vendor records", "Check totals vs lines", "Verify tax and currency", "Scan for duplicates"],
    outcome: "Vendor, totals, and duplicates checked",
    agent: "FINANCE_RULES",
    codename: "Ledger",
    role: "Rules & risk",
    glyph: "▣",
  },
  {
    key: "decide",
    title: "Your review",
    plain: "Your turn to review and decide",
    detail:
      "Agents stage the invoice with fields and flags. You open it, confirm what matters, then approve or send back.",
    does: ["Open the staged invoice", "Check flagged fields", "Approve or return"],
    outcome: "Ready for your decision",
    role: "Human",
    glyph: "✦",
  },
];

/** Desk coach copy — shown on ⓘ / first open, not as permanent hero text. */
export const HOME_COACH = {
  title: "Your desk at a glance",
  body: "See what needs attention, add an invoice on Home, or open the board. Agents handle reading and checks — you step in to decide.",
};

/** Rotating plain-language actions while each agent is working. */
export const AGENT_ACTIONS = {
  receive: [
    "Opening a case…",
    "Saving your file…",
    "Queuing the agents…",
  ],
  classify: [
    "Opening document…",
    "Scanning page layout…",
    "Checking document type…",
    "Confirming this is an invoice…",
  ],
  extract: [
    "Finding supplier…",
    "Reading invoice number…",
    "Pulling dates and amounts…",
    "Looking for PO number…",
    "Capturing currency and total…",
  ],
  finance: [
    "Matching vendor records…",
    "Checking totals vs lines…",
    "Verifying tax and currency…",
    "Running duplicate check…",
  ],
  decide: ["Handing off to you…"],
};

export const NOW_LABELS = {
  receive: "Receiving your file…",
  classify: "Classifier working…",
  extract: "Document reader working…",
  finance: "Finance check working…",
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
export const UPLOAD_WATCH_MIN_MS = 5200;

export const EVENT_TITLES = {
  CASE_UPLOADED: "Invoice uploaded",
  CASE_REGISTERED: "Invoice uploaded",
  DUPLICATE_UPLOAD_DETECTED: "Same file uploaded again",
  FIELDS_CORRECTED: "Fields corrected",
  FIELD_UPDATE: "Fields corrected",
  APPROVAL_APPROVED: "Approved",
  APPROVAL_RETURNED: "Sent back",
  APPROVAL_REJECTED: "Rejected",
  APPROVE: "Approved",
  RETURN: "Sent back",
  REJECT: "Rejected",
  STATE_TRANSITION: "Status changed",
  WORK_ITEM_COMPLETED: "Agent processing finished",
  WORK_ITEM_LEASED: "Agent processing started",
  EXTRACTION_ACCEPTED: "Extracted fields received",
  CASE_ROUTED: "Checks run and case routed",
  MODEL_JUDGEMENT_RECORDED: "Agent recommendation recorded",
};

export const CHECK_LABELS = {
  vendor: "Vendor",
  po: "Purchase order",
  tax: "Tax",
  duplicate: "Duplicate",
};
