const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "../webapp");
function load(file, deps = []) {
    let value;
    vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), {
        sap: {ui: {define: (names, factory) => { value = factory(...deps); }}},
        URL, Date, setTimeout, clearTimeout
    });
    return value;
}
const constants = load("model/constants.js");
const diagnostics = load("model/reviewDiagnostics.js");
const ruleMessages = load("model/financeRuleMessages.js", [constants]);
const agentInformation = load("model/agentInformation.js");
function BaseObject() {}
BaseObject.extend = (name, definition) => definition;
class Model { constructor(data) { this.data = data; } }
const store = load("model/CaseStore.js", [BaseObject, Model, null, null, null, constants, diagnostics]);
function map(role, validation = {}, status = "READY_FOR_APPROVAL") {
    const instance = Object.create(store);
    instance._model = {getProperty: key => key === "/permissions" ? role : undefined};
    return instance._mapCaseToSelectedInvoice({
        id: "case-1", file_name: "invoice.pdf", invoice_number: "INV-1", status,
        supplier_name: "Supplier", company_code: "1000", currency: "SAR", total_amount: "100.00",
        fields: {line_items: [{description: "Freight", quantity: 2, amount: "100.00"}]}, validation
    });
}
test("processor receives split-view capabilities and never manager decisions", () => {
    const result = map({processor: true, approver: false});
    assert.equal(result.processor, true);
    assert.equal(result.canDecide, false);
    assert.equal(result.canMarkReviewed, true);
    assert.equal(result.lineItems[0].description, "Freight");
    assert(result.pipelineSteps.some(step => step.title === "Processor Review"));
    assert(result.pipelineSteps.some(step => step.title === "Manager Approval"));
});
test("new review sessions default to full data and preserve recorded rule details", () => {
    const instance = Object.create(store);
    store.constructor.call(instance, {});
    assert.equal(instance._model.data.processorSplit, false);
    const rules = [{rule_id: "OVERALL_CONFIDENCE", parameter: "Minimum confidence: 0.75", outcome: "PASS"}];
    assert.equal(map({processor: true, approver: false}, {finance_rules: rules}).financeRules, rules);
});
test("approvers retain their full-data workflow and decision controls", () => {
    const result = map({processor: false, approver: true});
    assert.equal(result.processor, false);
    assert.equal(result.canProcess, false);
    assert.equal(result.canDecide, true);
    assert(!result.pipelineSteps.some(step => step.key === "processorReview"));
});
test("warning evidence overrides a conflicting ready status and prevents submission", () => {
    for (const validation of [{checks: {bank: "CHECK"}}, {confidence: .5}, {source_verdict: {comparisons: [{check: "bank", result: "MISMATCH"}]}}, {processor_exception: "Incorrect bank account"}]) {
        const result = map({processor: true, approver: false}, validation);
        assert.equal(result.status, "Needs Review");
        assert.equal(result.statusState, "Warning");
        assert.equal(result.canMarkReviewed, false);
        assert.match(result.exceptionText, /Payment blocked/);
        assert.equal(result.verdict.headline, "Exception detected");
    }
});
test("reviewed processor cases display Awaiting Approval", () => {
    const result = map({processor: true, approver: false}, {processor_review: {user_id: "faizan"}});
    assert.equal(result.status, "Awaiting Approval");
});
test("diagnostic badges distinguish pass, warning, fail and absent evidence", () => {
    assert.equal(diagnostics.badge("PASS").status, "Pass");
    assert.equal(diagnostics.badge("CHECK").status, "Warning");
    assert.equal(diagnostics.badge("FAIL").status, "Fail");
    assert.equal(diagnostics.badge("not_checked").status, "Not Run");
    assert.equal(diagnostics.groups({}).length, 3);
    assert.equal(diagnostics.exceptions({investigation: {}, verifier_matching: {}}).length, 0);
});

test("finance findings explain missing fields and duplicate candidates without raw evidence", () => {
    assert.match(ruleMessages.observation({rule_id: "REQUIRED_FIELDS_PRESENT", outcome: "FAIL", evidence: {missing_fields: ["invoice_number", "currency"]}}), /complete these invoice details: invoice number, currency/);
    const duplicate = ruleMessages.observation({rule_id: "BUSINESS_DUPLICATE", outcome: "FAIL", evidence: {matched_case_id: "internal-id"}});
    assert.match(duplicate, /possible duplicate/);
    assert(!duplicate.includes("internal-id"));
    assert.match(ruleMessages.observation({rule_id: "BUSINESS_DUPLICATE", outcome: "UNKNOWN"}), /not enough invoice information/);
});

test("finance findings turn confidence and item counts into readable messages", () => {
    assert.equal(ruleMessages.observation({rule_id: "OVERALL_CONFIDENCE", observed: "0.61", parameter: "Minimum confidence: 0.75", outcome: "FAIL"}),
        "Overall reading confidence is 61%; the required minimum is 75%. Verify the extracted details against the PDF.");
    assert.equal(ruleMessages.observation({rule_id: "LINE_ITEMS_PRESENT", observed: "3", outcome: "PASS"}), "3 line items were extracted from the invoice.");
    assert.match(ruleMessages.observation({rule_id: "FIELD_CONFIDENCE:currency", observed: "Not recorded", outcome: "UNKNOWN"}), /No reading-confidence score was recorded/);
});

test("unrecognized finance results do not leak provider responses or JSON", () => {
    const text = ruleMessages.observation({rule_id: "FUTURE_RULE", outcome: "UNKNOWN", observed: '{"provider_response":"technical detail"}'});
    assert.equal(text, "No confirmed result was recorded for this check.");
    assert(!text.includes("provider_response"));
});

test("exception banner consolidates overlapping duplicate and matching findings", () => {
    const result = map({processor: true, approver: false}, {
        checks: {duplicate: "suspected_duplicate"},
        business_duplicate: {matched_case_id: "other-case"},
        blocking: ["POTENTIAL_BUSINESS_DUPLICATE", "VALIDATION_EXCEPTION"],
        verifier_matching: {match_status: "UNKNOWN"},
        investigation: {status: "REVIEW_REQUIRED"}
    });
    assert.match(result.exceptionText, /This may be a duplicate invoice/);
    assert.match(result.exceptionText, /purchase order match is not confirmed/);
    assert.equal((result.exceptionText.match(/duplicate invoice/g) || []).length, 1);
    assert(!/suspected_duplicate|VALIDATION_EXCEPTION|FINANCE_RULES|RECONCILER/.test(result.exceptionText));
    assert.equal(result.canMarkReviewed, false);
});

test("unknown technical findings use a safe review message without hiding the exception", () => {
    const result = map({processor: true, approver: false}, {blocking: ["INTERNAL_NEW_RULE"]});
    assert.match(result.exceptionText, /Some automated checks need attention/);
    assert(!result.exceptionText.includes("INTERNAL_NEW_RULE"));
    assert.equal(result.status, "Needs Review");
});

test("every review agent has information and uses the saved client-facing findings", () => {
    for (const key of constants.AGENT_ORDER) {
        const findings = [{label: "Purchase order", value: "450001"}];
        const info = agentInformation.describe({key, agent: key, statusKey: "passed", status: "Passed", points: findings});
        assert(info.checks.length > 0, key);
        assert(info.purpose.length > 0, key);
        assert.equal(info.findings, findings);
        assert.match(info.notice, /saved result/);
    }
});

test("agent dialogs do not present pending or failed runs as successful findings", () => {
    for (const statusKey of ["pending", "running", "failed", "skipped"]) {
        const info = agentInformation.describe({key: "SCANNER", statusKey, points: [{label: "Old", value: "not current"}]});
        assert.equal(info.findings.length, 0);
        assert(!info.notice.includes("saved result"));
    }
});
