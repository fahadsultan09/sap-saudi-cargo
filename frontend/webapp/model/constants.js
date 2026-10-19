sap.ui.define([], function () {
    "use strict";

    var PROCESSING_STATUSES = ["RECEIVED", "PROCESSING"];
    var REVIEW_STATUSES = ["NEEDS_REVIEW", "RETURNED", "PROCESSING_ERROR"];
    var APPROVAL_STATUSES = ["READY_FOR_APPROVAL", "PENDING_APPROVAL"];
    var APPROVED_STATUSES = ["APPROVED", "POSTING", "POSTED", "POSTING_ERROR"];

    return {
        CASE_LIST_LIMIT: 200,
        CASES_PER_PAGE: 10,
        // How often the case list refreshes itself while the agents are still processing a case.
        REFRESH_INTERVAL_MS: 3000,
        // Snappier poll while watching a single case's pipeline (Upload stay-and-watch + Review).
        PIPELINE_POLL_MS: 1500,
        // Stay on Upload long enough to see the full 5-step track light up before Clear Desk.
        UPLOAD_WATCH_MIN_MS: 4200,
        UPLOAD_WATCH_MAX_MS: 14000,

        // AP Core stores times in UTC; they are shown in the time zone of the client profile's countryCode.
        COUNTRY_TIME_ZONES: {
            SA: { zone: "Asia/Riyadh", label: "KSA time" },
            AE: { zone: "Asia/Dubai", label: "UAE time" },
            BH: { zone: "Asia/Bahrain", label: "Bahrain time" },
            KW: { zone: "Asia/Kuwait", label: "Kuwait time" },
            OM: { zone: "Asia/Muscat", label: "Oman time" },
            QA: { zone: "Asia/Qatar", label: "Qatar time" },
            EG: { zone: "Africa/Cairo", label: "Egypt time" },
            PK: { zone: "Asia/Karachi", label: "Pakistan time" },
            GB: { zone: "Europe/London", label: "UK time" }
        },
        DEFAULT_TIME_ZONE: { zone: "UTC", label: "UTC" },

        PROCESSING_STATUSES: PROCESSING_STATUSES,
        // AP Core allows field corrections and approval decisions only in these statuses: a case needing
        // review is corrected first, and AP Core routes it to approval once its checks pass.
        EDITABLE_STATUSES: ["NEEDS_REVIEW", "RETURNED", "PROCESSING_ERROR"],
        DECIDABLE_STATUSES: APPROVAL_STATUSES,
        PROCESSOR_ROLES: ["AP_PROCESSOR", "ADMIN"],
        APPROVER_ROLES: ["AP_APPROVER", "FINANCE_MANAGER"],

        // Status groups shared by the KPI cards and the case filter on the dashboard.
        CASE_GROUPS: [
            { key: "processing", label: "In progress", statuses: PROCESSING_STATUSES, icon: "sap-icon://process", tone: "info" },
            { key: "review", label: "Needs review", statuses: REVIEW_STATUSES, icon: "sap-icon://inspect", tone: "warning" },
            { key: "awaiting", label: "Awaiting approval", statuses: APPROVAL_STATUSES, icon: "sap-icon://approvals", tone: "info" },
            { key: "approved", label: "Approved", statuses: APPROVED_STATUSES, icon: "sap-icon://accept", tone: "success" },
            { key: "rejected", label: "Rejected", statuses: ["REJECTED"], icon: "sap-icon://decline", tone: "error" }
        ],

        STATUS_LABELS: {
            RECEIVED: "Received",
            PROCESSING: "Agents processing",
            NEEDS_REVIEW: "Needs Review",
            READY_FOR_APPROVAL: "Ready for Approval",
            PENDING_APPROVAL: "Pending Approval",
            PROCESSING_ERROR: "Processing Error",
            RETURNED: "Returned",
            APPROVED: "Approved",
            REJECTED: "Rejected",
            POSTING: "Posting",
            POSTED: "Posted",
            POSTING_ERROR: "Posting Error"
        },

        STATUS_STATES: {
            RECEIVED: "Information",
            PROCESSING: "Information",
            NEEDS_REVIEW: "Warning",
            READY_FOR_APPROVAL: "Information",
            PENDING_APPROVAL: "Warning",
            PROCESSING_ERROR: "Error",
            RETURNED: "Warning",
            APPROVED: "Success",
            REJECTED: "Error",
            POSTING: "Information",
            POSTED: "Success",
            POSTING_ERROR: "Error"
        },

        // Editable invoice fields of AP Core, in display order.
        FIELDS: [
            { key: "supplier_name", label: "Supplier", required: true },
            { key: "supplier_id", label: "Supplier ID" },
            { key: "invoice_number", label: "Invoice Number", required: true },
            { key: "invoice_date", label: "Invoice Date (YYYY-MM-DD)" },
            { key: "po_number", label: "PO Number" },
            { key: "currency", label: "Currency", required: true },
            { key: "total_amount", label: "Total Amount", required: true },
            { key: "company_code", label: "Company Code" }
        ],

        CHECK_LABELS: { vendor: "Vendor", po: "Purchase order", tax: "Tax", duplicate: "Duplicate" },

        // Full invoice pipeline shown on Upload + Review. agent matches validation.agent_trace[].agent.
        PIPELINE_STEPS: [
            {
                key: "receive",
                title: "Received",
                service: "",
                description: "Your file lands in AP Console and gets a case.",
                icon: "sap-icon://upload-to-cloud",
                agent: null
            },
            {
                key: "classify",
                title: "Classify",
                service: "TOWER · AI Core",
                description: "Confirms it is an invoice or credit note.",
                icon: "sap-icon://inspect",
                agent: "TOWER"
            },
            {
                key: "extract",
                title: "Extract",
                service: "LENS · Document AI",
                description: "Reads supplier, amounts, PO, dates and line items.",
                icon: "sap-icon://create-form",
                agent: "LENS"
            },
            {
                key: "finance",
                title: "Finance rules",
                service: "Deterministic checks",
                description: "AP Core checks required fields and duplicates.",
                icon: "sap-icon://lab",
                agent: "FINANCE_RULES"
            },
            {
                key: "decide",
                title: "Needs review / Approve",
                service: "Clear Desk · Dock Decide",
                description: "Check fields on Clear Desk, then approve, return or reject on the dock.",
                icon: "sap-icon://approvals",
                agent: null
            }
        ],
        PIPELINE_STATUS_LABELS: {
            pending: "Pending",
            running: "Working…",
            done: "Done",
            failed: "Failed",
            skipped: "Not run"
        },

        // Live status line while a step is active (Upload rail + Review processing banner).
        PIPELINE_NOW_LABELS: {
            receive: "Receiving your file and opening a case…",
            classify: "Now: Classifying document (TOWER · AI Core)…",
            extract: "Now: Extracting invoice fields (LENS · Document AI)…",
            finance: "Now: Running finance rules (required fields, duplicates)…",
            decide: "Now: Handing off to Clear Desk / Dock Decide…"
        },

        // Plain-language text and icon for the agents' review reason codes (validation.review_decision).
        REVIEW_REASONS: {
            MANUAL_MODE_ENABLED: ["sap-icon://employee", "Every invoice is currently checked by a person before approval."],
            UNSUPPORTED_DOCUMENT_TYPE: ["sap-icon://document", "The document may not be an invoice or a credit note."],
            INVALID_CONFIDENCE: ["sap-icon://question-mark", "The agents could not tell what type of document this is."],
            LOW_CONFIDENCE: ["sap-icon://question-mark", "The agents are not sure what type of document this is."],
            MISSING_REQUIRED_FIELDS: ["sap-icon://edit", "Some required invoice details are missing."],
            LOW_CRITICAL_FIELD_CONFIDENCE: ["sap-icon://inspect", "Key details such as the amount or invoice number should be checked against the PDF."],
            VALIDATION_FAILED: ["sap-icon://lab", "The finance checks did not pass."],
            DUPLICATE_CHECK_FAILED: ["sap-icon://duplicate", "This invoice may already have been submitted."]
        },

        // Timeline colour and icon per audit event type; anything else is shown as information.
        EVENT_TONES: {
            FIELDS_CORRECTED: ["warning", "sap-icon://edit"],
            APPROVAL_APPROVED: ["success", "sap-icon://accept"],
            APPROVAL_RETURNED: ["warning", "sap-icon://undo"],
            APPROVAL_REJECTED: ["error", "sap-icon://decline"],
            CASE_REGISTERED: ["info", "sap-icon://upload"],
            DUPLICATE_UPLOAD_DETECTED: ["warning", "sap-icon://duplicate"],
            WORK_ITEM_COMPLETED: ["info", "sap-icon://process"]
        },

        // Readable audit-trail titles per AP Core event type.
        EVENT_TITLES: {
            CASE_REGISTERED: "Invoice uploaded",
            DUPLICATE_UPLOAD_DETECTED: "Same file uploaded again",
            WORK_ITEM_LEASED: "Agent processing started",
            WORK_ITEM_COMPLETED: "Agent processing finished",
            MODEL_JUDGEMENT_RECORDED: "Agent recommendation recorded",
            EXTRACTION_ACCEPTED: "Extracted fields received",
            CASE_ROUTED: "Checks run and case routed",
            STATE_TRANSITION: "Status changed",
            FIELDS_CORRECTED: "Fields corrected",
            APPROVAL_APPROVED: "Approved",
            APPROVAL_RETURNED: "Returned to processor",
            APPROVAL_REJECTED: "Rejected"
        },

        // Plain-language text for AP Core's blocking flags (validation.blocking); others show as is.
        BLOCKING_TEXTS: {
            REQUIRED_FIELDS_MISSING: "Some required invoice details are missing.",
            POTENTIAL_BUSINESS_DUPLICATE: "An invoice with the same number, supplier and company code already exists.",
            AMOUNT_INVALID: "The total amount is not a valid number.",
            AMOUNT_NOT_FINITE: "The total amount is not a valid number."
        }
    };
});
