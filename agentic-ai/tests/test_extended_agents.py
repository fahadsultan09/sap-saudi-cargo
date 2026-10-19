from agents.vector import VectorMatchingAgent
from agents.prism import PrismInvestigationAgent
from agents.plumb import PlumbReconciliationAgent


def test_vector_returns_unknown_when_sap_evidence_is_missing():
    result = VectorMatchingAgent().run({"po_number": "450001", "supplier_id": "V1"})
    assert result["status"] == "UNKNOWN"
    assert result["recommendation"] == "manual_review"


def test_vector_matches_only_with_complete_consistent_evidence():
    result = VectorMatchingAgent().run(
        {"po_number": "450001", "supplier_id": "V1", "company_code": "1000", "currency": "SAR", "total_amount": "100.00"},
        {"supplier_id": "V1", "company_code": "1000", "currency": "SAR", "available_amount": "125.00", "snapshot_hash": "abc", "fetched_at": "2026-10-16T10:00:00Z"},
    )
    assert result["status"] == "PASS"
    assert result["decision_class"] == "MODEL_JUDGEMENT"


def test_vector_fails_supplier_mismatch():
    result = VectorMatchingAgent().run(
        {"po_number": "450001", "supplier_id": "V1", "company_code": "1000", "currency": "SAR", "total_amount": "100"},
        {"supplier_id": "V2", "company_code": "1000", "currency": "SAR", "available_amount": "125"},
    )
    assert result["status"] == "FAIL"
    assert "SUPPLIER_MISMATCH" in result["reason_codes"]


def test_prism_uses_only_supplied_evidence_and_returns_followups():
    result = PrismInvestigationAgent().run(
        rule_results=[{"rule_code": "PO_MATCH", "outcome": "UNKNOWN", "reason": "PO data missing"}],
        sap_observations=[],
        extraction={"missing_fields": ["invoice_number"]},
    )
    assert result["status"] == "NEEDS_INVESTIGATION"
    assert any(x["action"] == "obtain_missing_evidence" for x in result["follow_up_actions"])
    assert any(x.get("field") == "invoice_number" for x in result["findings"])


def test_plumb_exact_match_is_candidate_not_paid():
    result = PlumbReconciliationAgent().run(
        {"items": [{"invoice_number": "INV-100", "currency": "SAR", "paid_amount": "100.00", "payment_reference": "PAY-1"}]},
        [{"case_id": "case-1", "sap_document_id": "19000001", "invoice_number": "INV-100", "currency": "SAR", "open_amount": "100.00"}],
    )
    assert result["matches"][0]["status"] == "MATCH_CANDIDATE"
    assert result["side_effects_performed"] is False
    assert result["next_step"] == "AP_CORE_RECONCILIATION_REVIEW"


def test_plumb_ambiguous_matches_require_review():
    item = {"invoice_number": "INV-100", "currency": "SAR", "amount": "100"}
    result = PlumbReconciliationAgent().run(item, [
        {"case_id": "c1", "invoice_number": "INV-100", "currency": "SAR", "amount": "100"},
        {"case_id": "c2", "invoice_number": "INV-100", "currency": "SAR", "amount": "100"},
    ])
    assert result["matches"][0]["status"] == "AMBIGUOUS"
    assert result["ambiguous_count"] == 1


def test_orchestrator_can_run_extended_agents_when_context_is_provided():
    from agents.orchestrator import APAgentOrchestrator
    from agents.mock_agents import MockLensAgent, MockTowerAgent

    class Rules:
        def run(self, **kwargs):
            return {"review_required": True, "missing_fields": ["invoice_number"], "missing_fields": ["invoice_number"]}

    flow = APAgentOrchestrator(tower=MockTowerAgent(), lens=MockLensAgent(), rules=Rules())
    result = flow.run("invoice.pdf", "invoice.pdf", extended_context={
        "invoice_fields": {"po_number": "450001", "supplier_id": "V1"},
        "rule_results": [{"rule_code": "PO_MATCH", "outcome": "UNKNOWN"}],
        "sap_observations": [],
        "payment_advice": {"invoice_number": "INV-1", "currency": "SAR", "amount": "10"},
        "posted_invoices": [],
    })
    names = [entry.agent for entry in result.agent_trace]
    assert "VECTOR" in names and "PRISM" in names and "PLUMB" in names
    assert result.matching["status"] == "UNKNOWN"
    assert result.investigation["status"] == "NEEDS_INVESTIGATION"
    assert result.reconciliation["matches"][0]["status"] == "UNMATCHED"
