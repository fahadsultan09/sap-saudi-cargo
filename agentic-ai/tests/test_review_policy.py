
import pytest

from agents.review_policy import decide_review


@pytest.fixture(autouse=True)
def review_settings(monkeypatch):
    monkeypatch.setenv("REVIEW_MODE", "manual")
    monkeypatch.setenv("AI_CONFIDENCE_THRESHOLD", "0.90")


def decide(**overrides):
    args = {
        "classification": "invoice",
        "confidence": 0.98,
        "validation_passed": True,
        "required_fields_complete": True,
        "critical_fields_confident": True,
        "duplicate_check_passed": True,
    }
    args.update(overrides)
    return decide_review(**args)


def test_manual_mode_always_requires_review():
    result = decide()

    assert result.manual_review_required is True
    assert result.automatic_processing_eligible is False
    assert "MANUAL_MODE_ENABLED" in result.reason_codes


def test_automatic_mode_allows_eligible_invoice(monkeypatch):
    monkeypatch.setenv("REVIEW_MODE", "automatic")

    result = decide()

    assert result.manual_review_required is False
    assert result.automatic_processing_eligible is True


def test_low_confidence_requires_review(monkeypatch):
    monkeypatch.setenv("REVIEW_MODE", "automatic")

    result = decide(confidence=0.75)

    assert result.manual_review_required is True
    assert "LOW_CONFIDENCE" in result.reason_codes


def test_missing_fields_require_review(monkeypatch):
    monkeypatch.setenv("REVIEW_MODE", "automatic")

    result = decide(required_fields_complete=False)

    assert result.manual_review_required is True
    assert "MISSING_REQUIRED_FIELDS" in result.reason_codes


def test_failed_validation_requires_review(monkeypatch):
    monkeypatch.setenv("REVIEW_MODE", "automatic")

    result = decide(validation_passed=False)

    assert result.manual_review_required is True
    assert "VALIDATION_FAILED" in result.reason_codes


def test_supporting_document_requires_review(monkeypatch):
    monkeypatch.setenv("REVIEW_MODE", "automatic")

    result = decide(classification="supporting_document")

    assert result.manual_review_required is True
    assert "UNSUPPORTED_DOCUMENT_TYPE" in result.reason_codes


def test_missing_confidence_requires_review(monkeypatch):
    monkeypatch.setenv("REVIEW_MODE", "automatic")

    result = decide(confidence=None)

    assert result.manual_review_required is True
    assert "INVALID_CONFIDENCE" in result.reason_codes


def test_percent_confidence_is_normalised(monkeypatch):
    monkeypatch.setenv("REVIEW_MODE", "automatic")

    result = decide(confidence=98)

    assert result.confidence == pytest.approx(0.98)
    assert result.automatic_processing_eligible is True
