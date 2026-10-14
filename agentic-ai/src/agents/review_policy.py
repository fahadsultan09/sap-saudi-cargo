
from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class ReviewDecision:
    manual_review_required: bool
    automatic_processing_eligible: bool
    reason_codes: list[str]
    reasons: list[str]
    review_mode: str
    confidence_threshold: float
    confidence: float | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _read_threshold() -> float:
    raw = os.getenv("AI_CONFIDENCE_THRESHOLD", "0.90")
    try:
        threshold = float(raw)
    except ValueError as exc:
        raise ValueError(
            "AI_CONFIDENCE_THRESHOLD must be a number between 0 and 1"
        ) from exc

    if not 0 <= threshold <= 1:
        raise ValueError(
            "AI_CONFIDENCE_THRESHOLD must be between 0 and 1"
        )

    return threshold


def _normalise_confidence(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None

    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return None

    # Accept either 0.95 or 95.
    if 1 < confidence <= 100:
        confidence /= 100

    if not 0 <= confidence <= 1:
        return None

    return confidence


def decide_review(
    *,
    classification: str | None,
    confidence: Any,
    validation_passed: bool,
    required_fields_complete: bool,
    critical_fields_confident: bool,
    duplicate_check_passed: bool,
    review_mode: str | None = None,
) -> ReviewDecision:
    """Decide whether an invoice may bypass manual review.

    This policy does not approve invoices or post them to SAP.
    Missing, unknown, or failed checks default to manual review.
    """

    mode = (
        review_mode
        if review_mode is not None
        else os.getenv("REVIEW_MODE", "manual")
    ).strip().lower()

    if mode not in {"manual", "automatic"}:
        raise ValueError(
            "REVIEW_MODE must be 'manual' or 'automatic'"
        )

    threshold = _read_threshold()
    score = _normalise_confidence(confidence)

    reasons: list[str] = []
    codes: list[str] = []

    if mode == "manual":
        codes.append("MANUAL_MODE_ENABLED")
        reasons.append("Manual review is required by configuration.")

    if classification not in {"invoice", "credit_note"}:
        codes.append("UNSUPPORTED_DOCUMENT_TYPE")
        reasons.append(
            "Document is not confidently classified as an invoice "
            "or credit note."
        )

    if score is None:
        codes.append("INVALID_CONFIDENCE")
        reasons.append("Classification confidence is missing or invalid.")
    elif score < threshold:
        codes.append("LOW_CONFIDENCE")
        reasons.append(
            f"Confidence {score:.0%} is below the {threshold:.0%} threshold."
        )

    if not required_fields_complete:
        codes.append("MISSING_REQUIRED_FIELDS")
        reasons.append("One or more required fields are missing.")

    if not critical_fields_confident:
        codes.append("LOW_CRITICAL_FIELD_CONFIDENCE")
        reasons.append(
            "One or more critical extracted fields need verification."
        )

    if not validation_passed:
        codes.append("VALIDATION_FAILED")
        reasons.append("Finance validation did not pass.")

    if not duplicate_check_passed:
        codes.append("DUPLICATE_CHECK_FAILED")
        reasons.append("Duplicate check did not pass.")

    eligible = not codes

    if eligible:
        reasons.append(
            "Configured confidence and validation requirements passed."
        )

    return ReviewDecision(
        manual_review_required=not eligible,
        automatic_processing_eligible=eligible,
        reason_codes=codes,
        reasons=reasons,
        review_mode=mode,
        confidence_threshold=threshold,
        confidence=score,
    )
