from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Protocol


def _decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return None


class SAPReadOnlyPort(Protocol):
    """Read-only boundary. Implementations must never write to SAP."""
    def get_purchase_order_context(self, po_number: str, supplier_id: str | None = None) -> dict[str, Any] | None: ...


class VectorMatchingAgent:
    """VECTOR recommends PO/GR matching from supplied or read-only SAP evidence.

    It never approves, changes AP Core case state, or writes to SAP. Missing SAP
    evidence is UNKNOWN (never PASS). Monetary comparisons use Decimal.
    """
    name = "VECTOR"

    def __init__(self, sap_reader: SAPReadOnlyPort | None = None):
        self.sap_reader = sap_reader

    def run(self, invoice: dict[str, Any], sap_observation: dict[str, Any] | None = None) -> dict[str, Any]:
        po_number = str(invoice.get("po_number") or "").strip()
        if not po_number:
            return {"agent": self.name, "decision_class": "MODEL_JUDGEMENT", "status": "UNKNOWN",
                    "match_status": "UNKNOWN", "reason_codes": ["PO_NUMBER_MISSING"],
                    "recommendation": "manual_review", "evidence": [], "missing_evidence": ["po_number"]}
        observation = sap_observation
        if observation is None and self.sap_reader is not None:
            observation = self.sap_reader.get_purchase_order_context(po_number, invoice.get("supplier_id"))
        if not observation:
            return {"agent": self.name, "decision_class": "MODEL_JUDGEMENT", "status": "UNKNOWN",
                    "match_status": "UNKNOWN", "reason_codes": ["SAP_PO_CONTEXT_UNAVAILABLE"],
                    "recommendation": "manual_review", "evidence": [],
                    "missing_evidence": ["read_only_sap_po_context"]}

        reasons: list[str] = []
        missing: list[str] = []
        invoice_supplier = str(invoice.get("supplier_id") or "").strip().casefold()
        po_supplier = str(observation.get("supplier_id") or "").strip().casefold()
        if not invoice_supplier or not po_supplier:
            missing.append("supplier_id")
        elif invoice_supplier != po_supplier:
            reasons.append("SUPPLIER_MISMATCH")

        invoice_company = str(invoice.get("company_code") or "").strip().casefold()
        po_company = str(observation.get("company_code") or "").strip().casefold()
        if not invoice_company or not po_company:
            missing.append("company_code")
        elif invoice_company != po_company:
            reasons.append("COMPANY_CODE_MISMATCH")

        invoice_currency = str(invoice.get("currency") or "").strip().upper()
        po_currency = str(observation.get("currency") or "").strip().upper()
        if not invoice_currency or not po_currency:
            missing.append("currency")
        elif invoice_currency != po_currency:
            reasons.append("CURRENCY_MISMATCH")

        invoice_amount = _decimal(invoice.get("total_amount"))
        po_amount = _decimal(observation.get("available_amount", observation.get("total_amount")))
        if invoice_amount is None or po_amount is None:
            missing.append("comparable_amount")
        elif invoice_amount > po_amount:
            reasons.append("INVOICE_EXCEEDS_PO_AVAILABLE_AMOUNT")

        if reasons:
            status = "FAIL"
            recommendation = "manual_review"
        elif missing:
            status = "UNKNOWN"
            recommendation = "manual_review"
        else:
            status = "PASS"
            recommendation = "continue_to_other_checks"
        return {"agent": self.name, "decision_class": "MODEL_JUDGEMENT", "status": status,
                "match_status": status, "reason_codes": reasons, "recommendation": recommendation,
                "evidence": [{
                    "source": observation.get(
                        "source",
                        "SAP_READ_ONLY_OBSERVATION",
                    ),
                    "po_number": po_number,
                    "fetched_at": observation.get("fetched_at"), 
                    "snapshot_hash": observation.get("snapshot_hash")
                }],
                "missing_evidence": missing, "po_number": po_number
                }
