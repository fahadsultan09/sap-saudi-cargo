from __future__ import annotations

from agents.contracts import ClassificationDecision
from agents.lens import LensExtractionAgent
from agents.orchestrator import APAgentOrchestrator
from agents.tower import TowerTriageAgent


class FakeAICore:
    def upload_and_process(self, file_path, email_metadata=None):
        return {
            "document_type": "invoice",
            "confidence": 0.94,
            "reason": "Invoice layout and amount due detected.",
        }


class FakeDocAI:
    def upload_and_process(self, file_path):
        return {"id": "job-123", "status": "DONE", "extraction": {}}

    @staticmethod
    def convert_results(raw):
        return {
            "classification_extraction": [],
            "detailed_extraction": [],
            "line_items": [],
        }


class FakeRules:
    def run(self, *, file_name, classification, converted):
        return {
            "document_type": "INVOICE",
            "invoice_type": "OTHER",
            "review_required": True,
            "review_reason": "Required fields need review",
            "missing_fields": ["invoice_number"],
            "extracted_header_fields": {},
            "line_items": [],
            "confidence": 0.5,
        }


def test_tower_validates_classification_output():
    result = TowerTriageAgent(client=FakeAICore()).run("invoice.pdf", "invoice.pdf")
    parsed = ClassificationDecision.model_validate(result)
    assert parsed.document_type == "invoice"
    assert parsed.confidence == 0.94


def test_lens_skips_non_invoice_documents():
    lens = LensExtractionAgent(client=FakeDocAI())
    result = lens.run("statement.pdf", {"document_type": "statement_of_account"})
    assert result["status"] == "skipped"
    assert result["raw_job"] == {}


def test_orchestrator_runs_tower_lens_and_deterministic_rules():
    flow = APAgentOrchestrator(
        tower=TowerTriageAgent(client=FakeAICore()),
        lens=LensExtractionAgent(client=FakeDocAI()),
        rules=FakeRules(),
    )
    result = flow.run("invoice.pdf", "invoice.pdf")
    assert [x.agent for x in result.agent_trace] == ["TOWER", "LENS", "FINANCE_RULES"]
    assert result.classification["document_type"] == "invoice"
    assert result.validation["blocking"] == ["TRIAGE_REVIEW_REQUIRED"]
    assert result.validation["document_ai_job_id"] == "job-123"


def test_mock_agents_do_not_fabricate_invoice_values():
    from agents.mock_agents import MockLensAgent, MockTowerAgent

    tower = MockTowerAgent().run("/tmp/invoice.pdf", "invoice.pdf")
    lens = MockLensAgent().run("/tmp/invoice.pdf", tower)
    assert tower["mode"] == "mock"
    assert lens["status"] == "completed"
    assert lens["converted"]["detailed_extraction"] == []
