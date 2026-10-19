from __future__ import annotations

from typing import Any


class PrismInvestigationAgent:
    """PRISM builds an evidence-grounded discrepancy investigation plan.

    It does not invent SAP facts, resolve UNKNOWN as PASS, authorize invoices,
    or execute external effects. The output is a recommendation only.
    """
    name = "PRISM"

    def run(self, *, rule_results: list[dict[str, Any]] | None = None,
            sap_observations: list[dict[str, Any]] | None = None,
            extraction: dict[str, Any] | None = None) -> dict[str, Any]:
        rules = rule_results or []
        observations = sap_observations or []
        findings: list[dict[str, Any]] = []
        follow_up: list[dict[str, str]] = []
        for rule in rules:
            outcome = str(rule.get("outcome", rule.get("status", "UNKNOWN"))).upper()
            code = str(rule.get("rule_code", rule.get("code", "UNSPECIFIED_RULE")))
            if outcome in {"FAIL", "UNKNOWN"}:
                findings.append({"source": "RULE_RESULT", "code": code, "outcome": outcome,
                                 "reason": str(rule.get("reason") or rule.get("message") or "No reason supplied")})
                if outcome == "UNKNOWN":
                    follow_up.append({"action": "obtain_missing_evidence", "for": code})
                else:
                    follow_up.append({"action": "review_discrepancy", "for": code})
        if not observations:
            follow_up.append({"action": "fetch_read_only_sap_observations", "for": "supplier_po_gr_company_code"})
        extracted = extraction or {}
        missing_fields = extracted.get("missing_fields", [])
        if isinstance(missing_fields, list):
            for field in missing_fields:
                findings.append({"source": "EXTRACTION_RESULT", "code": "MISSING_FIELD",
                                 "field": str(field), "outcome": "UNKNOWN"})
                follow_up.append({"action": "request_human_field_review", "for": str(field)})
        status = "CLEAR" if not findings and observations else ("NEEDS_INVESTIGATION" if findings else "INSUFFICIENT_EVIDENCE")
        return {"agent": self.name, "decision_class": "MODEL_JUDGEMENT", "status": status,
                "recommendation": "no_discrepancy_found_in_supplied_evidence" if status == "CLEAR" else "manual_review",
                "findings": findings, "follow_up_actions": _dedupe(follow_up),
                "evidence_count": len(observations) + len(rules),
                "limitations": ["Only supplied evidence was examined; this output does not authorize approval or posting."]}


def _dedupe(items: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[tuple[str, str]] = set()
    result = []
    for item in items:
        key = (item.get("action", ""), item.get("for", ""))
        if key not in seen:
            seen.add(key)
            result.append(item)
    return result
