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
    return {badge: badge, groups: groups, exceptions: exceptions, clientReasons: clientReasons};
});
