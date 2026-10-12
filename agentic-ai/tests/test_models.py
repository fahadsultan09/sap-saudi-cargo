"""Tests for the Pydantic LLM-response model and the repair-retry flow."""

import pytest

from triage.ai_core import AICoreClient, _aggregate_pages
from triage.models import ClassificationParseError, parse_classification


def test_valid_reply():
    c = parse_classification('{"document_type": "invoice", "confidence": 0.93, "reason": "has invoice no"}')
    assert c.document_type == "invoice" and c.confidence == 0.93 and c.reason == "has invoice no"


def test_reason_is_optional():
    assert parse_classification('{"document_type": "credit_note"}').reason is None


@pytest.mark.parametrize("raw,expected", [
    ("Invoice", "invoice"),
    ("Credit Note", "credit_note"),
    (" Statement-of-Account ", "statement_of_account"),
])
def test_type_is_normalised(raw, expected):
    assert parse_classification('{"document_type": "%s"}' % raw).document_type == expected


def test_fenced_and_wrapped_json():
    text = 'Sure!\n```json\n{"document_type": "invoice", "confidence": 0.8}\n```'
    assert parse_classification(text).document_type == "invoice"


def test_confidence_is_clamped():
    assert parse_classification('{"document_type": "invoice", "confidence": 7}').confidence == 0.07
    assert parse_classification('{"document_type": "invoice", "confidence": -1}').confidence == 0.0


@pytest.mark.parametrize("bad", [
    '{"document_type": "receipt"}',   # not in the closed set
    '{"confidence": 0.9}',            # missing type
    "I think it is an invoice",       # no JSON
    "",
])
def test_invalid_replies_rejected(bad):
    with pytest.raises(ClassificationParseError):
        parse_classification(bad)


def _client(replies):
    client = AICoreClient.__new__(AICoreClient)  # skip credential loading
    it = iter(replies)
    client._chat = lambda messages: next(it)
    return client


def test_repair_retry_succeeds():
    client = _client(["not json", '{"document_type": "invoice", "confidence": 0.9}'])
    r = client._classify([{"role": "user", "content": "x"}])
    assert r["document_type"] == "invoice" and r["ai_parse_status"] == "repaired"


def test_two_bad_replies_fail_cleanly():
    client = _client(["nope", '{"document_type": "receipt"}'])
    r = client._classify([{"role": "user", "content": "x"}])
    assert r["document_type"] is None and r["ai_parse_status"] == "failed"


def test_page_vote_not_just_first_page():
    pages = [
        {"document_type": "general_correspondence", "confidence": 0.5, "ai_parse_status": "ok"},
        {"document_type": "invoice", "confidence": 0.95, "ai_parse_status": "ok"},
        {"document_type": "invoice", "confidence": 0.9, "ai_parse_status": "ok"},
    ]
    assert _aggregate_pages(pages)["document_type"] == "invoice"
