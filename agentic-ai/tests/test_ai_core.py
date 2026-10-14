"""Unit tests for SAP AI Core (GPT-5.4) classification result conversion.

These tests verify the conversion from AI Core classification format
(document_type + confidence only) to the pipeline's DocumentEntity format,
without making any HTTP calls.

Note: AI Core is used for CLASSIFICATION ONLY. SAP Document AI (DOX)
handles detailed field extraction for invoices.
Run with:

    pytest tests/
"""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure src/ is on the path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import pytest

from triage.ai_core import AICoreClient


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def ai_core_classification():
    """Simulated SAP AI Core classification result (from GPT-5.4)."""
    return {
        "_source_file": "invoice_001.pdf",
        "_total_pages": 2,
        "page_results": [
            {
                "document_type": "invoice",
                "confidence": 0.95,
                "reason": "Invoice document",
                "page": 1,
            },
            {
                "document_type": "invoice",
                "confidence": 0.90,
                "reason": "Invoice continuation page",
                "page": 2,
            },
        ],
        "document_type": "invoice",
        "document_types_found": ["invoice"],
        "confidence": 0.95,
    }


@pytest.fixture
def ai_core_credit_note():
    """Simulated AI Core classification for a credit note."""
    return {
        "_source_file": "credit_note_001.pdf",
        "_total_pages": 1,
        "page_results": [
            {
                "document_type": "credit_note",
                "confidence": 0.92,
                "reason": "Credit note document",
                "page": 1,
            },
        ],
        "document_type": "credit_note",
        "document_types_found": ["credit_note"],
        "confidence": 0.92,
    }


# ── Convert results tests ───────────────────────────────────────────────────


class TestConvertResults:
    def test_full_conversion(self, ai_core_classification):
        result = AICoreClient.convert_results(ai_core_classification)
        assert "classification_extraction" in result
        assert "detailed_extraction" in result
        assert "line_items" in result
        assert "invoice_source" in result

    def test_only_document_type_converted(self, ai_core_classification):
        result = AICoreClient.convert_results(ai_core_classification)
        entities = result["classification_extraction"]
        names = [e["name"] for e in entities]
        assert "document_type" in names
        # AI Core classification only returns document_type — no invoice fields
        assert "invoice_subtype" not in names
        assert "invoice_number" not in names
        assert "po_number" not in names
        assert "vendor_number" not in names

    def test_entity_values(self, ai_core_classification):
        result = AICoreClient.convert_results(ai_core_classification)
        entities = result["classification_extraction"]
        lookup = {e["name"]: e["stringValue"] for e in entities}
        assert lookup["document_type"] == "invoice"

    def test_invoice_source_built(self, ai_core_classification):
        result = AICoreClient.convert_results(ai_core_classification)
        source = result["invoice_source"]
        assert source["file_name"] == "invoice_001.pdf"
        assert source["document_type"] == "invoice"

    def test_credit_note_conversion(self, ai_core_credit_note):
        result = AICoreClient.convert_results(ai_core_credit_note)
        entities = result["classification_extraction"]
        lookup = {e["name"]: e["stringValue"] for e in entities}
        assert lookup["document_type"] == "credit_note"

    def test_empty_classification(self):
        response = {"_source_file": "empty.pdf", "document_type": None,
                   "confidence": 0.0}
        result = AICoreClient.convert_results(response)
        assert result["classification_extraction"] == []
        assert result["line_items"] == []
        assert result["invoice_source"]["file_name"] == "empty.pdf"

    def test_line_items_always_empty(self, ai_core_classification):
        """AI Core classification does not return line items (DOX handles extraction)."""
        result = AICoreClient.convert_results(ai_core_classification)
        assert result["line_items"] == []

    def test_classification_equals_detailed(self, ai_core_classification):
        result = AICoreClient.convert_results(ai_core_classification)
        assert result["classification_extraction"] == result["detailed_extraction"]
