"""Exceptions that must never be presented as ready for approval."""
from typing import Any

PROBLEMS = {"FAIL", "FAILED", "ERROR", "WARNING", "WARN", "CHECK", "MISMATCH", "NOT_IN_SAP", "SUSPECTED_DUPLICATE"}


def review_exceptions(validation: dict[str, Any]) -> list[str]:
    reasons = []
    reasons.extend(str(code).replace("_", " ").lower() for code in validation.get("blocking", []))
    if validation.get("missing_fields"):
        reasons.append("Missing required fields: " + ", ".join(validation["missing_fields"]))
    verdict = validation.get("source_verdict") or {}
    if verdict.get("status") in {"MISMATCH", "NOT_FOUND", "INCOMPLETE", "ERROR"}:
        reasons.append(verdict.get("summary") or "SAP source checks require review")
    matching = validation.get("verifier_matching") or {}
    if matching and matching.get("match_status") not in {"PASS", "MATCH", "MATCHED"}:
        reasons.append("Purchase order matching requires review")
    investigation = validation.get("investigation") or {}
    if investigation and investigation.get("status") != "CLEAR":
        reasons.append("Investigation requires manual review")
    for key, value in (validation.get("checks") or {}).items():
        if str(value).upper() in PROBLEMS:
            reasons.append(f"{key.replace('_', ' ')}: {value}")
    for row in (validation.get("source_verdict") or {}).get("comparisons", []):
        if str(row.get("result", "")).upper() in PROBLEMS:
            reasons.append(str(row.get("label") or row.get("check")) + ": " + str(row.get("result")))
    confidence = validation.get("confidence")
    if isinstance(confidence, (int, float)) and 0 <= confidence < 0.75:
        reasons.append("Critical fields below reading confidence threshold")
    if validation.get("processor_exception"):
        reasons.append(str(validation["processor_exception"]))
    for trace in validation.get("agent_trace", []):
        if str(trace.get("status", "")).upper() in PROBLEMS:
            reasons.append(str(trace.get("summary") or trace.get("agent") or "Automated check failed"))
    return list(dict.fromkeys(reasons))
