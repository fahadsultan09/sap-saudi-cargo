sap.ui.define(["saudicargo/ap/automation/model/constants"], function (C) {
    "use strict";

    function fieldLabel(key) {
        var field = C.FIELDS.filter(function (item) { return item.key === key; })[0];
        return (field ? field.label.replace(/\s*\(.*\)$/, "") : key.replace(/_/g, " ")).toLowerCase();
    }

    function score(value) {
        if (typeof value !== "number" && typeof value !== "string") return null;
        if (String(value).trim() === "") return null;
        var number = Number(value);
        return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
    }

    function percent(value) { return Math.round(value * 1000) / 10 + "%"; }

    function observation(rule) {
        var id = String(rule.rule_id || "");
        var key = id.split(":")[1] || "field";
        var label = fieldLabel(key);
        var outcome = String(rule.outcome || "").toUpperCase();
        var evidence = rule.evidence || {};

        if (id === "REQUIRED_FIELDS_PRESENT") {
            if (outcome === "PASS") return "All required invoice details are available.";
            if (Array.isArray(evidence.missing_fields) && evidence.missing_fields.length) {
                return "Please complete these invoice details: " + evidence.missing_fields.map(fieldLabel).join(", ") + ".";
            }
            return outcome === "FAIL" ? "Some required invoice details are missing. Check the extracted fields against the PDF."
                : "The required invoice details have not been confirmed.";
        }
        if (id === "BUSINESS_DUPLICATE") {
            if (outcome === "PASS") return "No matching invoice was found using the supplier, invoice number and company code. Other duplicate checks may still be needed.";
            if (outcome === "FAIL") return "Another invoice has the same supplier, invoice number and company code. Compare the two invoices before proceeding; this is a possible duplicate.";
            return "There is not enough invoice information to confirm whether this is a duplicate.";
        }
        if (id.indexOf("REQUIRED_FIELD:") === 0 || id.indexOf("CONDITIONAL_FIELD:") === 0) {
            if (outcome === "PASS") return "The " + label + " was found on the invoice.";
            if (outcome === "FAIL") return "The " + label + " is missing. Enter it from the PDF before proceeding.";
            if (outcome === "WARNING") return "The " + label + " was not found. Check whether it is needed for this invoice.";
            return "The " + label + " has not been confirmed.";
        }
        if (id === "OVERALL_CONFIDENCE" || id.indexOf("FIELD_CONFIDENCE:") === 0) {
            var value = score(rule.observed);
            if (value === null) return "No reading-confidence score was recorded. Check the extracted details against the PDF.";
            var minimumMatch = /Minimum confidence:\s*([\d.]+)/i.exec(rule.parameter || "");
            var minimum = minimumMatch ? score(minimumMatch[1]) : null;
            return (id === "OVERALL_CONFIDENCE" ? "Overall reading confidence is " : "Reading confidence for the " + label + " is ")
                + percent(value) + (minimum === null ? "." : "; the required minimum is " + percent(minimum) + ".")
                + (outcome === "FAIL" ? " Verify the extracted details against the PDF." : "");
        }
        if (id === "LINE_ITEMS_PRESENT") {
            var count = rule.observed === "" || rule.observed == null ? NaN : Number(rule.observed);
            if (outcome === "FAIL") return "No line items were extracted. Check the invoice PDF for the missing items.";
            if (outcome === "PASS" && Number.isInteger(count) && count > 0) return count + (count === 1 ? " line item was" : " line items were") + " extracted from the invoice.";
            return outcome === "PASS" ? "Line items were extracted from the invoice." : "The extracted line item count was not recorded.";
        }
        // New/unrecognized rules must never expose provider text or serialized evidence.
        return outcome === "PASS" ? "This check completed successfully."
            : outcome === "FAIL" ? "This check found an issue. Review the invoice details before proceeding."
                : outcome === "WARNING" ? "This check needs a closer review before proceeding."
                    : "No confirmed result was recorded for this check.";
    }

    return {observation: observation};
});
