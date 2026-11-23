sap.ui.define([], function () {
    "use strict";
    var descriptions = {
        CLASSIFIER: {
            purpose: "Identifies the type of document before its invoice details are read. Classification confidence describes the document type, not the accuracy of extracted amounts.",
            checks: ["Recognises invoices, credit notes and other supported document types.", "Records classification confidence and the number of pages examined when supplied.", "Identifies mixed document packets when reported by classification."]
        },
        SCANNER: {
            purpose: "Reads the invoice details from the PDF. In SAP mode it uses SAP Document AI; a completed extraction does not by itself confirm that the invoice matches SAP records.",
            checks: ["Extracts invoice number, supplier, dates, currency, amounts and purchase order reference.", "Extracts line items and preserves source coordinates when available.", "Reports missing details and reading confidence for the subsequent finance checks."]
        },
        FINANCE_RULES: {
            purpose: "Applies deterministic rules to the extracted invoice details. The Finance Rules dialog shows the thresholds and outcomes saved for this invoice.",
            checks: ["Required fields for the invoice type.", "Required-field and overall extraction confidence.", "Presence of line items and advisory conditional fields."]
        },
        VERIFIER: {
            purpose: "Checks the invoice against read-only purchase order evidence. Missing evidence is reported as unconfirmed and is never treated as a successful match.",
            checks: ["Looks up the purchase order reference.", "Compares supplier, company code and currency where both sides supply values.", "Checks the invoice amount against the available purchase order amount."]
        },
        SOURCE_CHECK: {
            purpose: "Compares invoice details with the supplied SAP reference records. The current integration reads local SAP Excel exports, so these findings reflect those snapshots.",
            checks: ["Checks purchase order, supplier status and available bank details.", "Compares company code, currency, amount and invoice date.", "Checks goods receipts, service acceptance, G/L accounts and cost centers where applicable."]
        },
        RECONCILER: {
            purpose: "Reviews the supplied rule results, missing fields and SAP observations to recommend follow-up. It does not resolve discrepancies, approve invoices or post to SAP.",
            checks: ["Collects failed or unconfirmed checks and missing invoice details.", "Identifies evidence that still needs to be obtained.", "Recommends manual review when findings remain or supporting evidence is insufficient."]
        }
    };
    function describe(agent) {
        var info = descriptions[agent.key] || {purpose: "Information for this agent has not been recorded.", checks: []};
        var completed = ["passed", "check"].indexOf(agent.statusKey) >= 0;
        return {
            name: agent.agent, purpose: info.purpose, task: agent.task, status: agent.status, state: agent.state,
            checks: info.checks.map(function (text) { return {text: text}; }),
            summary: agent.result || "No result has been recorded.",
            findings: completed ? (agent.points || []) : [],
            notice: completed ? "These findings come from the saved result for this invoice. The checklist describes the agent's scope; it is not a claim that every check passed."
                : agent.statusKey === "running" ? "This agent is still working. Final findings are not available yet."
                    : agent.statusKey === "failed" ? "This agent could not complete its work. No successful result is implied."
                        : "This agent has not completed a run for this invoice. No findings have been inferred."
        };
    }
    return {describe: describe};
});
