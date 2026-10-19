"""Pipeline state container for the triage agent.

TriageState is a lightweight dict subclass with attribute-style access.
Each pipeline step receives the current state, performs its logic, and
returns an updated copy.
"""

from __future__ import annotations

from typing import Any


class TriageState(dict):
    """Mutable dict subclass used as the pipeline state.

    Acts like a normal dict but with attribute-style access for convenience.
    """
    def __getattr__(self, key: str) -> Any:
        try:
            return self[key]
        except KeyError:
            raise AttributeError(key)

    def __setattr__(self, key: str, value: Any) -> None:
        self[key] = value


def initial_state(
    *,
    file_path: str = "",
    file_name: str = "",
    classification_extraction: list[dict[str, Any]] | None = None,
    detailed_extraction: list[dict[str, Any]] | None = None,
    line_items: list[dict[str, Any]] | None = None,
    ai_core_classification: dict[str, Any] | None = None,
) -> TriageState:
    """Create a fresh TriageState with all expected keys initialised."""
    return TriageState(
        file_path=file_path,
        file_name=file_name,
        file_content=None,
        errors=[],
        evidence=[],
        header_fields={},
        line_items=line_items or [],
        field_confidences={},
        missing_required_fields=[],
        low_confidence_fields=[],
        review_required=False,
        review_reason=None,
        confidence=0.0,
        classification_extraction=classification_extraction or [],
        detailed_extraction=detailed_extraction or [],
        ai_core_classification=ai_core_classification or {},
        workflow_steps=[],
        workflow_summary={},
    )
