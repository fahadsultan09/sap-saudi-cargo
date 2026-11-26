from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any


def _money(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return Decimal(str(value).replace(",", "").strip()).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return None


class PlumbReconciliationAgent:
    """PLUMB proposes payment-advice/statement matches against supplied posted items.

    This component never marks an invoice paid and never writes to SAP. A caller
    must persist the recommendation and AP Core must own reconciliation state.
    """
    name = "PLUMB"

    def run(self, payment_advice: dict[str, Any], posted_invoices: list[dict[str, Any]]) -> dict[str, Any]:
        items = payment_advice.get("items")
        if not isinstance(items, list):
            items = [payment_advice]
        matches: list[dict[str, Any]] = []
        for item in items:
            reference = str(item.get("invoice_number") or item.get("reference") or "").strip().casefold()
            currency = str(item.get("currency") or "").strip().upper()
            amount = _money(item.get("paid_amount", item.get("amount")))
            candidates = []
            for posted in posted_invoices:
                posted_ref = str(posted.get("invoice_number") or posted.get("reference") or "").strip().casefold()
                posted_currency = str(posted.get("currency") or "").strip().upper()
                posted_amount = _money(posted.get("open_amount", posted.get("amount")))
                if reference and posted_ref == reference and currency and posted_currency == currency and amount is not None and posted_amount == amount:
                    candidates.append(posted)
            if len(candidates) == 1:
                status = "MATCH_CANDIDATE"
                target = {"case_id": candidates[0].get("case_id"), "sap_document_id": candidates[0].get("sap_document_id")}
                reason = "Unique exact reference, currency and amount match; reconciliation still requires AP Core confirmation."
            elif len(candidates) > 1:
                status, target, reason = "AMBIGUOUS", None, "Multiple posted items satisfy the supplied match keys."
            else:
                status, target, reason = "UNMATCHED", None, "No exact match using invoice reference, currency and amount."
            matches.append({"payment_reference": item.get("payment_reference"), "invoice_reference": item.get("invoice_number") or item.get("reference"),
                            "status": status, "candidate": target, "reason": reason,
                            "decision_class": "MODEL_JUDGEMENT"})
        return {"agent": self.name, "decision_class": "MODEL_JUDGEMENT", "status": "completed",
                "matches": matches, "matched_count": sum(x["status"] == "MATCH_CANDIDATE" for x in matches),
                "unmatched_count": sum(x["status"] == "UNMATCHED" for x in matches),
                "ambiguous_count": sum(x["status"] == "AMBIGUOUS" for x in matches),
                "side_effects_performed": False,
                "next_step": "AP_CORE_RECONCILIATION_REVIEW"}
