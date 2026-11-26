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
        assert.equal(result.verdict.headline, "Invoice is not ready for approval");
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

test("finance checks use everyday labels and the recorded percentage requirement", () => {
    const required = ruleMessages.presentation({rule_id: "REQUIRED_FIELD:invoice_number", outcome: "FAIL"});
    assert.equal(required.title, "Invoice number is included");
    assert.equal(required.resultLabel, "Needs attention");
    const confidence = ruleMessages.presentation({rule_id: "FIELD_CONFIDENCE:invoice_number", parameter: "Minimum confidence: 0.87", outcome: "PASS"});
    assert.equal(confidence.title, "Invoice number was read clearly");
    assert.equal(confidence.parameter, "A reading score of at least 87% is needed.");
    assert.equal(confidence.resultLabel, "Passed");
    const unknown = ruleMessages.presentation({rule_id: "INTERNAL_TECHNICAL_RULE", description: "raw provider detail", outcome: "UNKNOWN"});
    assert.equal(unknown.title, "Additional invoice check");
    assert(!JSON.stringify(unknown).includes("INTERNAL_TECHNICAL_RULE"));
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

test("purchase order lookup and matching share one visible step", () => {
    const steps = [
        {key: "po", agent: "VERIFIER", state: "done", statusLabel: "Done", checks: []},
        {key: "sapPo", agent: "SOURCE_CHECK", state: "done", statusLabel: "Matches", checks: [{title: "Purchase order found"}]},
        {key: "sapSupplier", state: "done"}
    ];
    const result = store._combinePurchaseOrderSteps(steps, {verifier_matching: {match_status: "PASS"}});
    assert.equal(result.length, 2);
    assert.equal(result[0].title, "Purchase order");
    assert.equal(result[0].state, "done");
    assert.equal(result[0].checks.length, 1);
    assert.equal(store.stepTarget("po"), "info:po");
    assert.equal(steps.length, 3, "Underlying agent steps remain intact");
});

test("combined purchase order step cannot pass with failed, incomplete or running checks", () => {
    const make = (match, lookup) => [{key: "po", state: match}, {key: "sapPo", state: lookup}];
    assert.equal(store._combinePurchaseOrderSteps(make("done", "failed"), {})[0].state, "failed");
    assert.equal(store._combinePurchaseOrderSteps(make("done", "done"), {verifier_matching: {match_status: "FAIL"}})[0].state, "failed");
    assert.equal(store._combinePurchaseOrderSteps(make("done", "running"), {})[0].state, "running");
    assert.equal(store._combinePurchaseOrderSteps(make("done", "done"), {verifier_matching: {match_status: "UNKNOWN"}})[0].state, "waiting");
    assert.equal(store._combinePurchaseOrderSteps(make("done", "skipped"), {})[0].state, "waiting");
});

test("accounting steps show independent G/L and cost center results", () => {
    const instance = Object.create(store);
    instance._model = {getProperty: () => false};
    const steps = instance.buildPipelineFromCase({status: "NEEDS_REVIEW", validation: {
        source_verdict: {comparisons: [
            {check: "gl_account", result: "MATCH"},
            {check: "cost_center", result: "MISMATCH", message: "Cost center needs review"}
        ]}
    }});
    assert.equal(steps.find(step => step.key === "sapSupplier").title, "Supplier info");
    assert.equal(steps.find(step => step.key === "sapGlAccounts").state, "done");
    assert.equal(steps.find(step => step.key === "sapCostCenters").state, "failed");
    assert(!steps.some(step => step.key === "sapAccounts"));
    assert.equal(store.stepTarget("sapGlAccounts"), "info:accounts");
    assert.equal(store.stepTarget("sapCostCenters"), "info:accounts");
});

test("response explains recorded mismatches and gives a specific next action", () => {
    const result = diagnostics.responseDetails({source_verdict: {comparisons: [
        {check: "amount", label: "Net amount", result: "MISMATCH", invoice: "520,380.00 INR", sap: "500,000.00 INR"},
        {check: "bank", result: "NOT_IN_SAP"},
        {check: "goods_receipt", result: "MISMATCH"}
    ]}}, {po_number: "450000002"}, []);
    const amount = result.find(item => item.title.includes("net amount"));
    assert.match(amount.text, /520,380.00 INR/);
    assert.match(amount.text, /500,000.00 INR/);
    assert.match(amount.action, /purchasing team/);
    const bank = result.find(item => item.title.includes("bank"));
    assert.match(bank.text, /No bank details were found/);
    assert.match(bank.action, /supplier records/);
    const receipt = result.find(item => item.title.includes("Goods receipt"));
    assert.match(receipt.text, /does not prove the goods were not delivered/);
    assert.match(receipt.action, /receiving or purchasing team/);
});

test("response does not invent comparison amounts when evidence is absent", () => {
    const result = diagnostics.responseDetails({source_verdict: {comparisons: [{check: "amount", result: "MISMATCH"}]}}, {}, []);
    assert.match(result[0].text, /could not be confirmed/);
    assert(!result[0].text.includes("undefined"));
    assert(result[0].action.length > 0);
});

test("line item amounts include currency and preserve zero and missing amounts", () => {
    const rows = store._processorLineItems({currency: "INR", fields: {line_items: [
        {amount: 441000}, {amount: 10, currency: "SAR"}, {net_amount: 0, amount: 99}, {}
    ]}});
    assert.equal(rows[0].amount, "441,000.00 INR");
    assert.equal(rows[1].amount, "10.00 SAR");
    assert.equal(rows[2].amount, "0.00 INR");
    assert.equal(rows[3].amount, "—");
});

test("live review shows provisional data without enabling review decisions", () => {
    const result = map({processor: true, approver: false}, {
        ai_core: {document_type: "invoice", confidence: .99},
        missing_fields: ["invoice_number"], confidence: .5,
        agent_trace: [{agent: "CLASSIFIER", status: "completed"}, {agent: "SCANNER", status: "completed"}],
        source_checks: [{check: "currency", result: "MATCH", sap: "SAR", invoice: "SAR"}]
    }, "PROCESSING");
    assert.equal(result.isProcessing, true);
    assert.equal(result.canEdit, false);
    assert.equal(result.canMarkReviewed, false);
    assert.equal(result.canDecide, false);
    assert.equal(result.exceptionText, "");
    assert.equal(result.fields.find(field => field.key === "currency").sap, "SAR");
    assert.equal(result.verdict.headline, "Checks in progress");
});

test("live updates do not overwrite a different invoice opened by the user", async () => {
    const instance = Object.create(store);
    instance._model = {getProperty: () => "other-case", setProperty: () => assert.fail("Must not update another case")};
    instance._applyLiveCase({id: "upload-case"});
});
