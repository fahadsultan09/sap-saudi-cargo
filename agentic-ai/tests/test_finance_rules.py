from triage import pipeline


def test_finance_rule_snapshot_uses_thresholds_and_values_from_the_run(monkeypatch):
    monkeypatch.setattr(pipeline, "MIN_CONFIDENCE_THRESHOLD", .91)
    monkeypatch.setattr(pipeline, "MIN_REQUIRED_FIELD_CONFIDENCE", .87)
    state = {"invoice_type": "FUEL", "document_type": "INVOICE",
             "header_fields": {name: "value" for name in pipeline.DEFAULT_REQUIRED_FIELDS},
             "field_confidences": {name: .9 for name in pipeline.DEFAULT_REQUIRED_FIELDS},
             "line_items": [{"description": "Fuel"}]}
    result = pipeline.validate_extraction(state)
    rules = {rule["rule_id"]: rule for rule in result["finance_rules"]}
    assert rules["OVERALL_CONFIDENCE"]["outcome"] == "FAIL"
    assert rules["OVERALL_CONFIDENCE"]["parameter"] == "Minimum confidence: 0.91"
    assert rules["FIELD_CONFIDENCE:invoice_number"]["parameter"] == "Minimum confidence: 0.87"
    assert rules["FIELD_CONFIDENCE:invoice_number"]["outcome"] == "PASS"
    assert rules["LINE_ITEMS_PRESENT"]["outcome"] == "PASS"
    assert rules["CONDITIONAL_FIELD:po_number"]["outcome"] == "WARNING"
    assert pipeline.build_triage_result(result)["triage_result"]["finance_rules"] == result["finance_rules"]


def test_missing_required_values_and_absent_confidence_are_reported_honestly():
    result = pipeline.validate_extraction({"invoice_type": "OTHER", "header_fields": {}, "field_confidences": {}, "line_items": []})
    rules = {rule["rule_id"]: rule for rule in result["finance_rules"]}
    assert rules["REQUIRED_FIELD:invoice_number"]["outcome"] == "FAIL"
    assert rules["FIELD_CONFIDENCE:invoice_number"]["outcome"] == "UNKNOWN"
    assert rules["LINE_ITEMS_PRESENT"]["outcome"] == "FAIL"
