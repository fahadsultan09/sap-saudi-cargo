"""Pydantic models that constrain what the LLM (SAP AI Core) may return.

The classifier must answer with one of a closed set of document types and an
optional free-text reason. Anything else is rejected here, so malformed model
output never flows silently into the triage pipeline.
"""

from __future__ import annotations

import json
import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

DocType = Literal[
    "invoice",
    "credit_note",
    "supporting_document",
    "reconciliation",
    "statement_of_account",
    "purchase_order_list",
    "general_correspondence",
]

DOC_TYPES: tuple[str, ...] = DocType.__args__  # type: ignore[attr-defined]


class AICoreClassification(BaseModel):
    """Validated LLM classification of one document (or email)."""

    model_config = ConfigDict(extra="ignore")

    document_type: DocType
    reason: Optional[str] = None
    # Optional: used for aggregation / review thresholds when the model gives it.
    confidence: Optional[float] = Field(default=None)

    @field_validator("document_type", mode="before")
    @classmethod
    def _normalize_type(cls, v: Any) -> Any:
        """'Credit Note' / 'credit-note' / ' INVOICE ' -> snake_case enum value."""
        if isinstance(v, str):
            return re.sub(r"[\s\-]+", "_", v.strip().lower())
        return v

    @field_validator("confidence", mode="before")
    @classmethod
    def _clamp_confidence(cls, v: Any) -> Any:
        if v is None or v == "":
            return None
        try:
            f = float(v)
        except (TypeError, ValueError):
            return None
        # Some models answer 0-100
        if f > 1.0 and f <= 100.0:
            f = f / 100.0
        return min(1.0, max(0.0, f))

    @field_validator("reason", mode="before")
    @classmethod
    def _reason_str(cls, v: Any) -> Any:
        if v is None:
            return None
        return str(v).strip() or None


class ClassificationParseError(ValueError):
    """The LLM reply could not be turned into an AICoreClassification."""


_FENCE_RE = re.compile(r"^```[a-zA-Z0-9_-]*\s*\n?|\n?```\s*$")


def extract_json_object(text: str) -> str:
    """Pull the first balanced {...} object out of an LLM reply.

    Handles code fences and prose before/after the JSON.
    """
    s = _FENCE_RE.sub("", text.strip()).strip()
    start = s.find("{")
    if start < 0:
        raise ClassificationParseError("no JSON object found in reply")
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(s)):
        ch = s[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return s[start : i + 1]
    raise ClassificationParseError("unterminated JSON object in reply")


def parse_classification(text: str) -> AICoreClassification:
    """Parse and validate an LLM reply. Raises ClassificationParseError."""
    try:
        raw = json.loads(extract_json_object(text))
        return AICoreClassification.model_validate(raw)
    except ClassificationParseError:
        raise
    except json.JSONDecodeError as exc:
        raise ClassificationParseError(f"invalid JSON: {exc}") from exc
    except ValidationError as exc:
        problems = "; ".join(
            f"{'.'.join(str(p) for p in e['loc']) or 'reply'}: {e['msg']}" for e in exc.errors()
        )
        raise ClassificationParseError(problems) from exc


def classification_json_schema() -> dict[str, Any]:
    """JSON schema for the provider's structured-output (response_format) option."""
    return {
        "type": "object",
        "properties": {
            "document_type": {"type": "string", "enum": list(DOC_TYPES)},
            "confidence": {"type": "number"},
            "reason": {"type": "string"},
        },
        "required": ["document_type", "confidence", "reason"],
        "additionalProperties": False,
    }
