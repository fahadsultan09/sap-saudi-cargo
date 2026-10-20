from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

DocumentKind = Literal[
    "invoice",
    "credit_note",
    "supporting_document",
    "reconciliation",
    "statement_of_account",
    "purchase_order_list",
    "general_correspondence",
    "other",
]
AgentStatus = Literal["completed", "skipped", "failed"]


class ClassificationDecision(BaseModel):
    """Validated CLASSIFIER result. It is evidence, not an authorization decision."""

    model_config = ConfigDict(extra="allow")
    document_type: DocumentKind
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str = Field(default="", max_length=2000)

    @field_validator("document_type", mode="before")
    @classmethod
    def normalize_document_type(cls, value: Any) -> str:
        value = (
            str(value or "other").strip().lower().replace("-", "_").replace(" ", "_")
        )
        aliases = {"statement": "statement_of_account", "other": "other"}
        value = aliases.get(value, value)
        allowed = {
            "invoice",
            "credit_note",
            "supporting_document",
            "reconciliation",
            "statement_of_account",
            "purchase_order_list",
            "general_correspondence",
            "other",
        }
        return value if value in allowed else "other"


class AgentTrace(BaseModel):
    agent: str
    status: AgentStatus
    duration_ms: int = Field(ge=0)
    summary: str = Field(default="", max_length=2000)
    details: dict[str, Any] = Field(default_factory=dict)


class AgentWorkflowResult(BaseModel):
    classification: dict[str, Any] = Field(default_factory=dict)
    extraction: dict[str, Any] = Field(default_factory=dict)
    triage: dict[str, Any] = Field(default_factory=dict)
    agent_trace: list[AgentTrace] = Field(default_factory=list)
    validation: dict[str, Any] = Field(default_factory=dict)
    matching: dict[str, Any] = Field(default_factory=dict)
    investigation: dict[str, Any] = Field(default_factory=dict)
    reconciliation: dict[str, Any] = Field(default_factory=dict)
