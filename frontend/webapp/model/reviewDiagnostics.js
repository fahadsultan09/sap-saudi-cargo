sap.ui.define([], function () {
    "use strict";
    var FAIL = ["FAIL", "FAILED", "ERROR", "MISMATCH", "NOT_IN_SAP"];
    var WARN = ["WARNING", "WARN", "CHECK", "SUSPECTED_DUPLICATE"];
    var PASS = ["PASS", "PASSED", "MATCH", "MATCHED", "VALID", "CLEAR", "NO_DUPLICATE"];
    function badge(value) {
        var code = String(value || "").toUpperCase();
        return FAIL.indexOf(code) >= 0 ? {status: "Fail", state: "Error"}
            : WARN.indexOf(code) >= 0 ? {status: "Warning", state: "Warning"}
                : PASS.indexOf(code) >= 0 ? {status: "Pass", state: "Success"} : {status: "Not Run", state: "None"};
    }
    function groups(v) {
        var rows = (v.source_verdict || {}).comparisons || [];
        var checks = v.checks || {};
        var defs = [
            {title: "ZATCA/VAT Compliance", keys: ["zatca", "vat", "tax", "arithmetic", "invoice_date", "currency", "amount", "company_code"]},
            {title: "PO Matching & Line Items", keys: ["po", "purchase_order", "goods_receipt", "service_entry", "gl_account", "cost_center", "line_items", "duplicate"]},
            {title: "Vendor Identification & Bank Details", keys: ["vendor", "supplier", "supplier_status", "bank", "bank_details"]}
        ];
        return defs.map(function (def) {
            var items = rows.filter(function (row) { return def.keys.indexOf(row.check) >= 0; }).map(function (row) {
                return Object.assign({label: row.label || row.check, detail: row.reason || row.detail || "", code: row.check}, badge(row.result));
            });
            def.keys.forEach(function (key) {
                if (Object.prototype.hasOwnProperty.call(checks, key)) {
                    items.push(Object.assign({label: key.replace(/_/g, " "), code: key, detail: "Recorded validation result"}, badge(checks[key])));
                }
            });
            if (!items.length) items.push({label: "No validation evidence supplied", status: "Not Run", state: "None", detail: "This category has not been verified."});
            return {title: def.title, checks: items};
        });
    }
    function exceptions(v) {
        var reasons = [];
        var verdict = v.source_verdict || {};
        if (["MISMATCH", "NOT_FOUND", "INCOMPLETE", "ERROR"].indexOf(verdict.status) >= 0) reasons.push(verdict.summary || "SAP source checks require review");
        if (v.verifier_matching && Object.keys(v.verifier_matching).length && ["PASS", "MATCH", "MATCHED"].indexOf(v.verifier_matching.match_status) < 0) reasons.push("Purchase order matching requires review");
        if (v.investigation && Object.keys(v.investigation).length && v.investigation.status !== "CLEAR") reasons.push("Investigation requires manual review");
        Object.keys(v.checks || {}).forEach(function (key) {
            var result = badge(v.checks[key]);
            if (result.state === "Error" || result.state === "Warning") reasons.push(key.replace(/_/g, " ") + ": " + v.checks[key]);
        });
        ((v.source_verdict || {}).comparisons || []).forEach(function (row) {
            var result = badge(row.result);
            if (result.state === "Error" || result.state === "Warning") reasons.push((row.label || row.check) + ": " + row.result);
        });
        if (typeof v.confidence === "number" && v.confidence >= 0 && v.confidence < 0.75) reasons.push("Critical fields below reading confidence threshold");
        if (v.processor_exception) reasons.push(v.processor_exception);
        (v.agent_trace || []).forEach(function (trace) {
            if (["Error", "Warning"].indexOf(badge(trace.status).state) >= 0) reasons.push(trace.summary || trace.agent || "Automated check failed");
        });
        (v.blocking || []).forEach(function (code) { reasons.push(code.replace(/_/g, " ").toLowerCase()); });
        if (v.missing_fields && v.missing_fields.length) reasons.push("Missing required fields: " + v.missing_fields.join(", "));
        return reasons.filter(function (reason, i) { return reasons.indexOf(reason) === i; });
    }
    function clientReasons(v, agents, status) {
        var messages = {};
        function add(key, text) { messages[key] = text; }
        function check(key) {
            var templates = {
                duplicate: "This may be a duplicate invoice. Compare it with the existing invoice before proceeding.",
                po: "The purchase order match is not confirmed. Check the invoice against its purchase order.",
                purchase_order: "The purchase order match is not confirmed. Check the invoice against its purchase order.",
                supplier: "The supplier details need checking against SAP.", vendor: "The supplier details need checking against SAP.",
                supplier_status: "The supplier is not cleared for processing in SAP. Ask the responsible team to review its status.",
                bank: "The supplier's bank details could not be confirmed in SAP. Verify them before proceeding.",
                bank_details: "The supplier's bank details could not be confirmed in SAP. Verify them before proceeding.",
                amount: "The invoice amount needs checking against the purchase order.",
                arithmetic: "The invoice totals do not reconcile. Check the amounts and calculations.",
                tax: "The tax details need review.", vat: "The VAT details need review.", zatca: "The invoice compliance details need review.",
                currency: "The invoice currency needs checking against the purchase order.",
                company_code: "The invoice company code needs checking against the purchase order.",
                invoice_date: "The invoice date needs review.", goods_receipt: "Receipt of the goods has not been confirmed in SAP.",
                service_entry: "Acceptance of the services has not been confirmed in SAP.",
                gl_account: "The accounting details need review.", cost_center: "The accounting details need review.",
                line_items: "Check the extracted line items against the PDF."
            };
            if (templates[key]) add(key === "purchase_order" ? "po" : key === "vendor" ? "supplier" : key === "bank_details" ? "bank" : key, templates[key]);
        }
        if (status === "PROCESSING_ERROR") add("extraction", "The invoice could not be processed automatically. Check the PDF or re-run extraction.");
        if (v.business_duplicate) check("duplicate");
        Object.keys(v.checks || {}).forEach(function (key) {
            if (["Error", "Warning"].indexOf(badge(v.checks[key]).state) >= 0) check(key);
        });
        ((v.source_verdict || {}).comparisons || []).forEach(function (row) {
            if (["Error", "Warning"].indexOf(badge(row.result).state) >= 0) check(row.check);
        });
        var matching = v.verifier_matching || {};
        if (Object.keys(matching).length && ["PASS", "MATCH", "MATCHED"].indexOf(matching.match_status) < 0) check("po");
        if (typeof v.confidence === "number" && v.confidence >= 0 && v.confidence < .75) add("confidence", "Some invoice details were read with low confidence. Verify them against the PDF.");
        if ((v.missing_fields || []).length) add("fields", "Required invoice details are missing. Complete the highlighted fields.");
        if (v.processor_exception) add("reported", "An issue was reported during review. Check the reported notes before proceeding.");
        (v.blocking || []).forEach(function (code) {
            if (/DUPLICATE/.test(code)) check("duplicate");
            else if (/PO_MATCH/.test(code)) check("po");
            else if (/AMOUNT_/.test(code)) check("amount");
            else if (/REQUIRED_FIELDS/.test(code)) add("fields", "Required invoice details are missing. Complete the highlighted fields.");
            else if (/TRIAGE_REVIEW|CONFIDENCE/.test(code)) add("reading", "Check the extracted invoice details against the PDF.");
            else if (/EXTRACTION|AGENT_PROCESSING_DISABLED/.test(code)) add("extraction", "The invoice could not be processed automatically. Check the PDF or re-run extraction.");
        });
        (agents || []).filter(function (agent) { return ["check", "failed"].indexOf(agent.statusKey) >= 0; }).forEach(function (agent) {
            if (agent.key === "VERIFIER") check("po");
            if (agent.key === "CLASSIFIER") add("classification", "The document type needs checking. Confirm that the PDF is an invoice or credit note.");
            if (agent.key === "SCANNER" && !messages.confidence && !messages.fields && !messages.extraction) add("reading", "Check the extracted invoice details against the PDF.");
        });
        if (!Object.keys(messages).length) add("review", "Some automated checks need attention. Review the issues and invoice details before proceeding.");
        return Object.keys(messages).map(function (key) { return messages[key]; });
    }
    function responseDetails(v, invoice, agents) {
        var items = {};
        function add(key, title, text, action) { items[key] = {title: title, text: text, action: action}; }
        function value(input) { return typeof input === "string" || typeof input === "number" ? String(input) : ""; }
        function names(fields) {
            var labels = {supplier_id: "supplier number", comparable_amount: "invoice amount", po_number: "purchase order number", total_amount: "total amount", read_only_sap_po_context: "purchase order details from SAP", company_code: "company code"};
            return fields.map(function (field) { return labels[field] || String(field).replace(/_/g, " "); }).join(", ");
        }
        var templates = {
            purchase_order: ["Purchase order could not be confirmed", "The purchase order lookup did not pass.", "Check the purchase order number under Extracted Fields. If it is correct, ask the purchasing team to check the SAP record, then re-run extraction."],
            supplier: ["Supplier details do not match", "The supplier information on the invoice could not be matched to the SAP record.", "Compare the supplier on the PDF with Supplier info. Correct any reading error, or ask the purchasing team to confirm the correct supplier."],
            supplier_status: ["Supplier needs clearance in SAP", "The supplier record did not pass the status check.", "Ask the team responsible for supplier records to review the supplier's status in SAP, then re-run the checks."],
            bank: ["Supplier bank details need confirmation", "The supplier's bank details did not pass the SAP check.", "Ask the team responsible for supplier records to verify the bank details in SAP. Then re-run the checks."],
            goods_receipt: ["Goods receipt is not confirmed", "The SAP check did not confirm receipt for all purchase order items that require it. This does not prove the goods were not delivered.", "Ask the receiving or purchasing team to check and record any missing goods receipt in SAP. Then re-run the checks."],
            service_entry: ["Service acceptance is not confirmed", "The SAP check did not confirm acceptance of all required services.", "Ask the responsible team to review and accept the service entry in SAP, then re-run the checks."],
            gl_account: ["G/L account needs review", "An accounting account on the purchase order did not pass the SAP check.", "Ask Finance to verify that the G/L account exists and is open for posting, then re-run the checks."],
            cost_center: ["Cost center needs review", "A cost center on the purchase order did not pass the SAP check.", "Ask Finance to verify that the cost center exists and is valid, then re-run the checks."]
        };
        ((v.source_verdict || {}).comparisons || []).forEach(function (row) {
            if (["Error", "Warning"].indexOf(badge(row.result).state) < 0) return;
            var template = templates[row.check];
            if (template) {
                var text = template[1];
                if (row.check === "bank" && row.result === "NOT_IN_SAP") text = "No bank details were found for this supplier in the SAP reference data used for this check.";
                if (row.check === "purchase_order" && row.result === "NOT_IN_SAP") text = "Purchase order " + (invoice.po_number || (v.source_verdict || {}).po_number || "on this invoice") + " was not found in the SAP reference data.";
                add(row.check, template[0], text, template[2]);
            } else if (["amount", "currency", "company_code", "invoice_date"].indexOf(row.check) >= 0) {
                var label = {amount: row.label === "Net amount" ? "net amount (before tax)" : "amount", currency: "currency", company_code: "company code", invoice_date: "date"}[row.check];
                var compared = value(row.invoice) && value(row.sap);
                var text = compared ? "Invoice " + label + ": " + value(row.invoice) + ". Purchase order " + label + ": " + value(row.sap) + "."
                    : "The invoice " + label + " could not be confirmed against the purchase order.";
                if (row.check === "invoice_date" && compared) text = "The invoice is dated " + value(row.invoice) + "; the purchase order was created on " + value(row.sap) + ". Check that the invoice date is valid for this order.";
                add(row.check, "Check the invoice " + label, text, "Compare these details with the PDF and the purchase order under Info. Correct any reading error; if the SAP record needs changing, ask the purchasing team to update it. Then re-run the checks.");
            }
        });
        if (v.business_duplicate || (v.blocking || []).some(function (code) { return /DUPLICATE/.test(code); })) {
            add("duplicate", "Possible duplicate invoice", "Another submitted invoice has the same supplier, invoice number and company code.", "Find the earlier invoice in the dashboard using its supplier and invoice number, and compare both documents. Confirm that this invoice has not already been processed before proceeding.");
        }
        var match = v.verifier_matching || {};
        if (Object.keys(match).length && ["PASS", "MATCH", "MATCHED"].indexOf(match.match_status) < 0 && !items.purchase_order) {
            var missing = match.missing_evidence || [];
            if (missing.length || !Object.keys(items).length) add("po", "Purchase order comparison is incomplete",
                missing.length ? "The comparison is missing: " + names(missing) + "." : "The system could not confirm that this invoice matches its purchase order.",
                "Check the purchase order and invoice details under Info and Extracted Fields. Complete missing invoice details, or ask the purchasing team to confirm the SAP record, then re-run the checks.");
        }
        if ((v.missing_fields || []).length) add("fields", "Required details are missing", "Missing details: " + names(v.missing_fields) + ".", "Use View Document to check the PDF, fill in the missing values under Extracted Fields, and save your corrections.");
        if (typeof v.confidence === "number" && v.confidence >= 0 && v.confidence < .75) add("reading", "Some details may have been read incorrectly", "The system's overall reading score is " + Math.round(v.confidence * 100) + "%.", "Use View Document to compare the extracted details with the PDF. Correct any mistakes and save them.");
        var lowFields = /low confidence on required fields:\s*([^;]+)/i.exec(v.triage_review_reason || "");
        if (lowFields && (v.blocking || []).indexOf("TRIAGE_REVIEW_REQUIRED") >= 0) add("reading", "Check details the system could not read clearly", "Please verify: " + names(lowFields[1].split(/\s*,\s*/)) + ".", "Use View Document to compare these values with the PDF. Correct any mistakes under Extracted Fields and save them.");
        if (v.processor_exception) add("reported", "A reviewer reported an issue", "Review note: " + v.processor_exception, "Resolve the reported issue and re-run the checks before submitting the invoice for approval.");
        if (invoice.status === "PROCESSING_ERROR") add("processing", "Automatic reading failed", "The system could not finish processing this PDF.", "Re-run Extraction. If it still cannot be read, enter the invoice details from the PDF under Extracted Fields.");
        if (!Object.keys(items).length) {
            clientReasons(v, agents, invoice.status).forEach(function (reason, index) {
                add("review" + index, "Review needed", reason, "Open the relevant agent in Agents to see its findings. Compare the invoice with the PDF and SAP details, resolve the issue, and run the checks again.");
            });
        }
        return Object.keys(items).map(function (key) { return items[key]; });
    }
    return {badge: badge, groups: groups, exceptions: exceptions, clientReasons: clientReasons, responseDetails: responseDetails};
});
