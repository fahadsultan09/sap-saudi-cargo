from __future__ import annotations

from decimal import Decimal

from .config import Settings
from .enums import RuleCode
from .schemas import Invoice, PurchaseOrder, RuleResult, Vendor


def evaluate(
    invoice: Invoice,
    po: PurchaseOrder | None,
    vendor: Vendor | None,
    duplicate_sources: list[str],
    settings: Settings,
) -> list[RuleResult]:
    gross = invoice.net + invoice.vat
    expected_vat = (invoice.net * settings.vat_rate).quantize(Decimal("0.01"))
    rules = [
        RuleResult(
            code=RuleCode.DUPLICATE,
            passed=not duplicate_sources,
            evidence=f"Matched: {', '.join(duplicate_sources)}"
            if duplicate_sources
            else "No SAP ledger or other case match",
        ),
        RuleResult(
            code=RuleCode.VENDOR_ACTIVE,
            passed=vendor is not None and vendor.active,
            evidence=(
                f"Vendor {invoice.vendor} active={vendor.active if vendor else False}"
            ),
        ),
        RuleResult(
            code=RuleCode.VAT,
            passed=abs(invoice.vat - expected_vat) <= settings.vat_tolerance,
            evidence=f"Expected VAT {expected_vat}; actual {invoice.vat}",
        ),
        RuleResult(
            code=RuleCode.PO_EXISTS,
            passed=po is not None,
            evidence=f"PO {invoice.po_number}",
        ),
    ]
    if po is not None:
        deviation = abs(gross - po.gross) / po.gross if po.gross > 0 else None
        rules.extend(
            [
                RuleResult(
                    code=RuleCode.PO_VENDOR,
                    passed=po.vendor == invoice.vendor,
                    evidence=f"PO vendor {po.vendor}; invoice vendor {invoice.vendor}",
                ),
                RuleResult(
                    code=RuleCode.CURRENCY,
                    passed=po.currency == invoice.currency,
                    evidence=(
                        f"PO currency {po.currency}; "
                        f"invoice currency {invoice.currency}"
                    ),
                ),
                RuleResult(
                    code=RuleCode.PO_TOLERANCE,
                    passed=deviation is not None and deviation <= settings.po_tolerance,
                    evidence=(
                        f"Invoice gross {gross}; PO gross {po.gross}; "
                        f"tolerance {settings.po_tolerance}"
                    ),
                ),
                RuleResult(
                    code=RuleCode.GR_MISSING,
                    passed=po.goods_receipt_gross is not None,
                    evidence=f"Goods receipt gross {po.goods_receipt_gross}",
                ),
            ]
        )
        if po.goods_receipt_gross is not None:
            rules.append(
                RuleResult(
                    code=RuleCode.GR_COVERAGE,
                    passed=po.goods_receipt_gross >= gross,
                    evidence=(
                        f"Goods receipt {po.goods_receipt_gross}; invoice gross {gross}"
                    ),
                )
            )
    return rules
