"""The worker passes each finished agent step on to AP Core while the agents run."""
import json
from contextlib import contextmanager

import pytest

import worker


class FakeStream:
    def __init__(self, events):
        self.lines = [json.dumps(event) for event in events]

    def raise_for_status(self):
        pass

    def iter_lines(self):
        return iter(self.lines)


class FakeAPCore:
    def __init__(self):
        self.progress = []

    def submit_progress(self, case_id, *, agent_trace, source_checks):
        self.progress.append((len(agent_trace), len(source_checks)))


def use_stream(monkeypatch, events):
    @contextmanager
    def fake_stream(*args, **kwargs):
        yield FakeStream(events)

    monkeypatch.setattr(worker.httpx, "stream", fake_stream)


def test_each_step_is_reported_before_the_result(tmp_path, monkeypatch):
    pdf = tmp_path / "invoice.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    use_stream(monkeypatch, [
        {"type": "step", "step": {"agent": "CLASSIFIER"}},
        {"type": "check", "check": {"check": "purchase_order"}},
        {"type": "step", "step": {"agent": "SOURCE_CHECK"}},
        {"type": "result", "fields": {"invoice_number": "INV-1"}, "validation": {}},
    ])
    ap_core = FakeAPCore()
    result = worker.process_with_progress(ap_core, "case-1", pdf, "invoice.pdf")
    assert result["fields"] == {"invoice_number": "INV-1"}
    assert ap_core.progress == [(1, 0), (1, 1), (2, 1)]


def test_an_agent_error_fails_the_attempt(tmp_path, monkeypatch):
    pdf = tmp_path / "invoice.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    use_stream(monkeypatch, [{"type": "error", "detail": "Document processing failed: RuntimeError"}])
    with pytest.raises(RuntimeError, match="Document processing failed"):
        worker.process_with_progress(FakeAPCore(), "case-1", pdf, "invoice.pdf")
