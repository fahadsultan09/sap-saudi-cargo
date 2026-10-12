from __future__ import annotations

from typing import Any


class DeterministicTriageRules:
    """Runs the existing deterministic triage pipeline after AI outputs are validated.

    This is intentionally not an LLM agent. Rules, not model confidence, govern
    review status and business eligibility.
    """
    name = "FINANCE_RULES"

    def run(self, *, file_name: str, classification: dict[str, Any], converted: dict[str, Any]) -> dict[str, Any]:
        from triage.runner import run_triage
        return run_triage(
            classification_extraction=converted.get("classification_extraction", []),
            detailed_extraction=converted.get("detailed_extraction", []),
            line_items=converted.get("line_items", []),
            file_name=file_name,
            ai_core_classification=classification,
        )
