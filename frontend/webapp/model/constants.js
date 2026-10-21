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
        // An invoice still queued after this long means the processing worker is probably not running.
        QUEUE_WARNING_MS: 2 * 60 * 1000,
        // Upload without a case id: how long the local step animation runs before the dashboard opens.
        UPLOAD_WATCH_MIN_MS: 4200,

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

        // Fields section: the groups its tiles are shown in, and which group each invoice field or SAP check
        // belongs to.
        FIELD_GROUPS: [
            { key: "invoice", title: "Invoice", icon: "sap-icon://document-text" },
            { key: "supplier", title: "Supplier", icon: "sap-icon://supplier" },
            { key: "po", title: "Purchase order", icon: "sap-icon://sales-order" },
            { key: "receipts", title: "Goods receipt & accounts", icon: "sap-icon://shipping-status" }
        ],
        FIELD_GROUP_OF: {
            invoice_number: "invoice",
            invoice_date: "invoice",
            currency: "invoice",
            total_amount: "invoice",
            amount: "invoice",
            supplier_name: "supplier",
            supplier_id: "supplier",
            supplier_status: "supplier",
            bank: "supplier",
            po_number: "po",
            company_code: "po",
            goods_receipt: "receipts",
            service_entry: "receipts",
            gl_account: "receipts",
            cost_center: "receipts"
        },

        // SAP data checks that compare an invoice field, shown on that field's row (check → field key).
        FIELD_CHECKS: {
            purchase_order: "po_number",
            supplier: "supplier_name",
            invoice_date: "invoice_date",
            currency: "currency",
            company_code: "company_code"
        },

        // Full invoice pipeline shown on Upload + Review. agent matches validation.agent_trace[].agent.
        PIPELINE_STEPS: [
            {
                key: "receive",
                title: "Received",
                // A click on the step goes to its outcome on the review page.
                target: "audit",
                service: "",
                description: "Your file lands in AP Console and gets a case.",
                icon: "sap-icon://upload-to-cloud",
                agent: null
            },
            {
                key: "classify",
                title: "Classify",
                target: "agents:CLASSIFIER",
                service: "AI classification",
                description: "Confirms it is an invoice or credit note.",
                icon: "sap-icon://inspect",
                agent: "CLASSIFIER"
            },
            {
                key: "extract",
                title: "Extract",
                target: "agents:SCANNER",
                service: "AI extraction",
                description: "Reads supplier, amounts, PO, dates and line items.",
                icon: "sap-icon://create-form",
                agent: "SCANNER"
            },
            {
                key: "finance",
                title: "Finance rules",
                target: "agents:FINANCE_RULES",
                service: "Rules",
                description: "AP Core checks required fields and duplicates.",
                icon: "sap-icon://lab",
                agent: "FINANCE_RULES"
            },
            // traceOnly: shown as done only when the agent reported running (never assumed).
            {
                key: "po",
                title: "PO match",
                target: "agents:VERIFIER",
                service: "Purchase order",
                description: "Compares the invoice with its purchase order in SAP.",
                icon: "sap-icon://compare",
                agent: "VERIFIER",
                traceOnly: true
            },
            // The SAP data check (agent SOURCE_CHECK) as its own steps; sourceChecks are the checks each covers.
            {
                key: "sapPo",
                title: "Fetch PO",
                target: "info:po",
                service: "SAP data check",
                description: "Finds the invoice's purchase order in SAP.",
                icon: "sap-icon://sales-order",
                agent: "SOURCE_CHECK",
                traceOnly: true,
                sourceChecks: ["purchase_order"]
            },
            {
                key: "sapSupplier",
                title: "Verify supplier",
                target: "info:supplier",
                service: "SAP data check",
                description: "Checks the supplier, that it is active, and its bank details in SAP.",
                icon: "sap-icon://supplier",
                agent: "SOURCE_CHECK",
                traceOnly: true,
                sourceChecks: ["supplier", "supplier_status", "bank"]
            },
            {
                key: "sapFields",
                title: "Compare fields",
                target: "details:differences",
                service: "SAP data check",
                description: "Compares currency, company code, amount and date with the purchase order.",
                icon: "sap-icon://compare",
                agent: "SOURCE_CHECK",
                traceOnly: true,
                sourceChecks: ["company_code", "currency", "amount", "invoice_date"]
            },
            {
                key: "sapReceipt",
                title: "Goods receipt",
                target: "info:receipts",
                service: "SAP data check",
                description: "Checks the goods or services were received in SAP.",
                icon: "sap-icon://shipping-status",
                agent: "SOURCE_CHECK",
                traceOnly: true,
                sourceChecks: ["goods_receipt", "service_entry"]
            },
            {
                key: "sapAccounts",
                title: "Accounts",
                target: "info:accounts",
                service: "SAP data check",
                description: "Checks the PO's GL accounts and cost centers exist and are open.",
                icon: "sap-icon://accounting-document-verification",
                agent: "SOURCE_CHECK",
                traceOnly: true,
                sourceChecks: ["gl_account", "cost_center"]
            },
            {
                key: "investigate",
                title: "Investigation",
                target: "agents:RECONCILER",
                service: "Summary",
                description: "Explains open findings and recommends what to check next.",
                icon: "sap-icon://search",
                agent: "RECONCILER",
                traceOnly: true
            },
            {
                key: "decide",
                title: "Review & approve",
                target: "overview",
                service: "You and the approver",
                description: "A person checks the invoice, then an approver approves, returns or rejects it.",
                icon: "sap-icon://approvals",
                agent: null
            }
        ],
        // Order the agents run in (validation.agent_trace[].agent).
        AGENT_ORDER: ["CLASSIFIER", "SCANNER", "FINANCE_RULES", "VERIFIER", "SOURCE_CHECK", "RECONCILER"],
        PIPELINE_STATUS_LABELS: {
            pending: "Pending",
            running: "Working…",
            done: "Done",
            failed: "Failed",
            skipped: "Not run"
        },

        // Live status line while a step is active (Upload rail + Review processing banner).
        PIPELINE_NOW_LABELS: {
            receive: "Queued: waiting for the processing worker to pick up the invoice…",
            classify: "Now: Recognising the document type…",
            extract: "Now: Reading the invoice details…",
            finance: "Now: Running the basic invoice checks…",
            po: "Now: Looking up the purchase order…",
            sapPo: "Now: Fetching the purchase order from SAP…",
            sapSupplier: "Now: Verifying the supplier in SAP…",
            sapFields: "Now: Comparing the invoice fields with the purchase order…",
            sapReceipt: "Now: Checking the goods receipt in SAP…",
            sapAccounts: "Now: Checking the account assignment in SAP…",
            investigate: "Now: Summarising the findings…"
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

        // The SAP data check broken into steps: what each check does, and whether it fetches data
        // ("Found") or compares a value ("Matches").
        SOURCE_CHECK_STEPS: {
            purchase_order: ["Fetching the purchase order", true],
            supplier: ["Fetching the supplier", true],
            supplier_status: ["Checking the supplier is active", false],
            company_code: ["Comparing the company code", false],
            currency: ["Comparing the currency", false],
            amount: ["Comparing the net amount", false],
            invoice_date: ["Checking the invoice date", false],
            goods_receipt: ["Fetching goods receipts", true],
            service_entry: ["Fetching service entry sheets", true],
            gl_account: ["Checking the GL accounts", false],
            cost_center: ["Checking the cost centers", false],
            bank: ["Fetching the bank details", true]
        },

        // SAP data check results that count as a difference.
        SOURCE_DISCREPANCIES: ["MISMATCH", "NOT_IN_SAP"],

        // One row of the verdict's comparison table: result label and colour.
        SOURCE_RESULTS: {
            MATCH: { label: "Matches", state: "Success", icon: "sap-icon://accept" },
            MISMATCH: { label: "Differs", state: "Error", icon: "sap-icon://decline" },
            NOT_IN_SAP: { label: "Not in SAP", state: "Error", icon: "sap-icon://decline" },
            NOT_ON_INVOICE: { label: "Not on invoice", state: "None", icon: "sap-icon://less" },
            NOT_COMPARABLE: { label: "Not comparable", state: "None", icon: "sap-icon://less" }
        },

        // Document types the agents recognise: label and icon.
        DOCUMENT_TYPES: {
            invoice: ["Invoice", "sap-icon://document-text"],
            credit_note: ["Credit note", "sap-icon://credit-card"],
            statement_of_account: ["Statement of account", "sap-icon://customer-financial-fact-sheet"],
            purchase_order_list: ["Purchase order", "sap-icon://sales-order"],
            supporting_document: ["Supporting document", "sap-icon://attachment"],
            payment_advice: ["Payment advice", "sap-icon://payment-approval"]
        },

        // Issues to resolve, in this order of areas.
        ISSUE_AREAS: ["Invoice details", "Purchase order", "Supplier", "Amounts & dates", "Goods receipt", "Accounting"],
        // Where an issue of each area is resolved: "info:<sub-tab>" for SAP records, otherwise Fields.
        ISSUE_SECTIONS: {
            Supplier: "info:supplier",
            "Purchase order": "info:po",
            "Goods receipt": "info:receipts",
            Accounting: "info:accounts"
        },
        // SAP purchasing document types (EKKO-BSART) in words.
        PO_TYPES: {
            NB: "Standard purchase order",
            FO: "Framework order",
            UB: "Stock transport order"
        },
        // Per SAP check: [area, short title, what the values are called in the detail line].
        SOURCE_ISSUES: {
            purchase_order: ["Purchase order", "Purchase order not found", "PO"],
            supplier: ["Supplier", "Supplier mismatch", "supplier"],
            supplier_status: ["Supplier", "Supplier blocked in SAP", "status"],
            bank: ["Supplier", "No bank account in SAP", "bank account"],
            company_code: ["Amounts & dates", "Company code mismatch", "company code"],
            currency: ["Amounts & dates", "Currency mismatch", "currency"],
            amount: ["Amounts & dates", "Amount mismatch", "amount"],
            invoice_date: ["Amounts & dates", "Date mismatch", "date"],
            goods_receipt: ["Goods receipt", "Goods not received", "goods receipt"],
            service_entry: ["Goods receipt", "Service entry not accepted", "service entry"],
            gl_account: ["Accounting", "GL account not valid", "GL account"],
            cost_center: ["Accounting", "Cost center not valid", "cost center"]
        },

        // Overview tab: the verdict's headline, icon and colour per case status.
        VERDICT_HEADLINES: {
            RECEIVED: ["Checks in progress", "sap-icon://pending", "Information"],
            PROCESSING: ["Checks in progress", "sap-icon://process", "Information"],
            PROCESSING_ERROR: ["Could not be read automatically", "sap-icon://error", "Error"],
            NEEDS_REVIEW: ["Not ready for approval", "sap-icon://alert", "Warning"],
            RETURNED: ["Returned for corrections", "sap-icon://undo", "Warning"],
            READY_FOR_APPROVAL: ["Ready for approval", "sap-icon://approvals", "Success"],
            PENDING_APPROVAL: ["Ready for approval", "sap-icon://approvals", "Success"],
            APPROVED: ["Approved", "sap-icon://accept", "Success"],
            POSTING: ["Approved", "sap-icon://accept", "Success"],
            POSTED: ["Posted to SAP", "sap-icon://accept", "Success"],
            REJECTED: ["Rejected", "sap-icon://decline", "Error"]
        },
        // SAP data checks whose problems lie in SAP itself, not on the invoice.
        SAP_SIDE_CHECKS: ["purchase_order", "supplier_status", "bank", "goods_receipt", "service_entry", "gl_account",
            "cost_center"],

        // Reading confidence bands: below CONFIDENCE_REVIEW the agents send the invoice to review
        // (MIN_CONFIDENCE_THRESHOLD in agentic-ai), from CONFIDENCE_HIGH it is shown as high.
        CONFIDENCE_REVIEW: 0.75,
        CONFIDENCE_HIGH: 0.85,

        // Agent stepper on the Overview tab: what each agent does.
        AGENT_TASKS: {
            CLASSIFIER: "Recognises the type of document",
            SCANNER: "Reads the invoice details",
            FINANCE_RULES: "Checks required details and duplicates",
            VERIFIER: "Matches the invoice with its purchase order",
            SOURCE_CHECK: "Compares the invoice with the SAP data",
            RECONCILER: "Reviews all findings and recommends a next step"
        },
        // Agent status: [label, state, result text when the agent has no result yet, icon].
        AGENT_STATUSES: {
            pending: ["Pending", "None", "Waiting to start.", "sap-icon://pending"],
            running: ["Working…", "Information", "Working on it…", "sap-icon://synchronize"],
            passed: ["Passed", "Success", "", "sap-icon://sys-enter-2"],
            check: ["Check", "Warning", "", "sap-icon://alert"],
            failed: ["Failed", "Error", "This agent could not complete.", "sap-icon://error"],
            skipped: ["Not run", "None", "Not needed for this invoice.", "sap-icon://less"]
        },
        // The agent's icon on the stepper (the same as its step on Steps).
        AGENT_ICONS: {
            CLASSIFIER: "sap-icon://inspect",
            SCANNER: "sap-icon://create-form",
            FINANCE_RULES: "sap-icon://lab",
            VERIFIER: "sap-icon://compare",
            SOURCE_CHECK: "sap-icon://accounting-document-verification",
            RECONCILER: "sap-icon://search"
        },
        // Why the purchase order match failed, in plain words.
        PO_MATCH_REASONS: {
            SUPPLIER_MISMATCH: "supplier",
            COMPANY_CODE_MISMATCH: "company code",
            CURRENCY_MISMATCH: "currency",
            INVOICE_EXCEEDS_PO_AVAILABLE_AMOUNT: "amount above the open purchase order value",
            PO_NUMBER_MISSING: "no purchase order number on the invoice",
            SAP_PO_CONTEXT_UNAVAILABLE: "purchase order data not available"
        },
        // Details the purchase order match could not compare, in plain words.
        PO_MATCH_EVIDENCE: {
            supplier_id: "supplier",
            company_code: "company code",
            currency: "currency",
            comparable_amount: "amount"
        },
        // What the final review (RECONCILER) found, in plain words.
        RECONCILER_FINDINGS: {
            TRIAGE_REVIEW_REQUIRED: "details read with low confidence",
            REQUIRED_FIELDS_MISSING: "required details missing",
            VERIFIER_PO_MATCH: "the invoice doesn't match its purchase order",
            SAP_DATA_CHECK: "differences with the SAP data"
        },

        // What a finished pipeline step did, in plain words (instead of the agents' own output).
        STEP_DONE_TEXTS: {
            classify: "Document type recognised.",
            extract: "Invoice details read.",
            finance: "Basic invoice checks completed.",
            po: "Purchase order looked up.",
            investigate: "Findings summarised for review."
        },

    };
});
