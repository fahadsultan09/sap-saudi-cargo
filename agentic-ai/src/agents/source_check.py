from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

# Words that differ between an invoice's supplier name and the SAP supplier master
# without meaning a different company ("Red Sea Logistics Est." vs "RED SEA LOGISTICS").
LEGAL_WORDS = {
    "the",
    "and",
    "co",
    "company",
    "corp",
    "corporation",
    "est",
    "establishment",
    "inc",
    "llc",
    "ltd",
    "limited",
    "plc",
    "pvt",
    "private",
    "gmbh",
    "ab",
    "sa",
    "wll",
    "fze",
    "fzco",
}
# These must be compared (not missing on either side) for an invoice to count as a full match.
CORE_CHECKS = ("purchase_order", "supplier", "currency", "amount")
DISCREPANCY_RESULTS = {"MISMATCH", "NOT_IN_SAP"}
AMOUNT_TOLERANCE = Decimal("0.01")


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def _money(value: Any) -> Decimal | None:
    text = _text(value).replace(",", "")
    if not text:
        return None
    try:
        amount = Decimal(text)
    except (InvalidOperation, ValueError):
        return None
    return amount if amount.is_finite() else None


def _amount_text(amount: Decimal, currency: str) -> str:
    return f"{amount:,.2f} {currency}".strip()


def _date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(_text(value)[:10])
    except ValueError:
        return None


def _name_key(name: str) -> str:
    words = re.findall(r"[a-z0-9]+", name.casefold())
    return " ".join(word for word in words if word not in LEGAL_WORDS)


def _same_name(first: str, second: str) -> bool:
    a, b = _name_key(first), _name_key(second)
    return bool(a and b) and (a == b or a in b or b in a)


def _same_id(first: Any, second: Any) -> bool:
    """SAP keys are often zero-padded in one export and not in another."""
    a, b = _text(first).lstrip("0"), _text(second).lstrip("0")
    return bool(a) and a == b


def _row(
    check: str, label: str, invoice: Any, sap: Any, table: str, result: str, message: str
) -> dict[str, Any]:
    return {
        "check": check,
        "label": label,
        "invoice": _text(invoice),
        "sap": _text(sap),
        "sap_table": table,
        "result": result,
        "message": message,
    }


class SourceCheckAgent:
    """SOURCE_CHECK compares an extracted invoice with the SAP reference data.

    It reads the local SAP Excel exports through the read-only readers and returns a
    verdict: every compared field with its invoice and SAP value, and the discrepancies.
    It never approves, changes AP Core case state, or writes to SAP; AP Core routes the
    case on the verdict and a person still decides.
    """

    name = "SOURCE_CHECK"

    def __init__(self, po_reader: Any, finance_reader: Any):
        self.po_reader = po_reader
        self.finance_reader = finance_reader

    def run(self, invoice: dict[str, Any]) -> dict[str, Any]:
        po_number = _text(invoice.get("po_number"))
        if not po_number:
            return self._verdict(
                "NOT_FOUND",
                [],
                po_number,
                None,
                "There is no PO number on the invoice, so it could not be checked against SAP.",
            )
        po = self.po_reader.get_purchase_order_context(po_number)
        if po is None:
            return self._verdict(
                "NOT_FOUND",
                [],
                po_number,
                None,
                f"PO {po_number} was not found in the SAP purchase order data.",
            )

        rows = [
            self._purchase_order(po),
            *self._supplier(invoice, po),
            self._same_value(
                "company_code",
                "Company code",
                invoice.get("company_code"),
                po.get("company_code"),
                "EKKO",
            ),
            self._same_value(
                "currency",
                "Currency",
                _text(invoice.get("currency")).upper(),
                _text(po.get("currency")).upper(),
                "EKKO",
            ),
            self._amount(invoice, po),
            self._invoice_date(invoice, po),
            *self._receipts(po_number, po),
            *self._account_assignments(po_number),
            self._bank(po),
        ]
        rows = [row for row in rows if row]

        discrepancies = [row["message"] for row in rows if row["result"] in DISCREPANCY_RESULTS]
        missing = [
            row["label"]
            for row in rows
            if row["check"] in CORE_CHECKS and row["result"] not in {"MATCH", *DISCREPANCY_RESULTS}
        ]
        if discrepancies:
            count = len(discrepancies)
            status, summary = (
                "MISMATCH",
                (
                    f"{count} difference{'s' if count > 1 else ''} with the SAP data; "
                    "review before approval."
                ),
            )
        elif missing:
            status, summary = (
                "INCOMPLETE",
                (f"Could not fully check against SAP; missing: {', '.join(missing).lower()}."),
            )
        else:
            status, summary = (
                "MATCH",
                ("All invoice fields match the SAP data; the approver can approve right away."),
            )
        return self._verdict(status, rows, po_number, po, summary, discrepancies)

    def _verdict(
        self,
        status: str,
        rows: list[dict[str, Any]],
        po_number: str,
        po: dict[str, Any] | None,
        summary: str,
        discrepancies: list[str] | None = None,
    ) -> dict[str, Any]:
        return {
            "agent": self.name,
            "decision_class": "RULE_RESULT",
            "status": status,
            "summary": summary,
            "po_number": po_number,
            "comparisons": rows,
            "discrepancies": discrepancies
            if discrepancies is not None
            else ([summary] if status == "NOT_FOUND" else []),
            "sources": sorted({row["sap_table"] for row in rows} | {"EKKO"}),
            "source": (po or {}).get("source", "LOCAL_SAP_EXCEL_EXPORT"),
            "fetched_at": (po or {}).get("fetched_at"),
            "snapshot_hash": (po or {}).get("snapshot_hash"),
        }

    # ------------------------------------------------------------------ checks

    def _purchase_order(self, po: dict[str, Any]) -> dict[str, Any]:
        if po.get("deletion_indicator"):
            return _row(
                "purchase_order",
                "Purchase order",
                po["po_number"],
                "deleted",
                "EKKO",
                "MISMATCH",
                f"PO {po['po_number']} is marked as deleted in SAP.",
            )
        return _row(
            "purchase_order",
            "Purchase order",
            po["po_number"],
            po["po_number"],
            "EKKO",
            "MATCH",
            f"PO {po['po_number']} exists in SAP.",
        )

    def _supplier(self, invoice: dict[str, Any], po: dict[str, Any]) -> list[dict[str, Any]]:
        supplier = po.get("supplier")
        invoice_id = _text(invoice.get("supplier_id"))
        invoice_name = _text(invoice.get("supplier_name"))
        if supplier is None:
            return [
                _row(
                    "supplier",
                    "Supplier",
                    invoice_name or invoice_id,
                    po.get("supplier_id"),
                    "LFA1",
                    "NOT_IN_SAP",
                    f"The PO's supplier {po.get('supplier_id')} is not in the SAP supplier master.",
                )
            ]
        sap_name = " ".join(
            filter(None, [_text(supplier.get("name")), _text(supplier.get("name_2"))])
        )
        sap_label = f"{sap_name} ({supplier['supplier_id']})"
        if not invoice_id and not invoice_name:
            row = _row(
                "supplier",
                "Supplier",
                "",
                sap_label,
                "LFA1",
                "NOT_ON_INVOICE",
                "The invoice shows no supplier name or number.",
            )
        elif (invoice_id and not _same_id(invoice_id, supplier["supplier_id"])) or (
            invoice_name and not _same_name(invoice_name, sap_name)
        ):
            row = _row(
                "supplier",
                "Supplier",
                invoice_name or invoice_id,
                sap_label,
                "LFA1",
                "MISMATCH",
                f"In SAP the PO's supplier is {sap_label}; "
                f"the invoice is from {invoice_name or invoice_id}.",
            )
        else:
            row = _row(
                "supplier",
                "Supplier",
                invoice_name or invoice_id,
                sap_label,
                "LFA1",
                "MATCH",
                f"The supplier matches the PO's supplier {sap_label}.",
            )

        blocks = [
            label
            for key, label in (
                ("posting_block", "blocked for posting"),
                ("purchasing_block", "blocked for purchasing"),
                ("deletion_flag", "marked for deletion"),
            )
            if supplier.get(key)
        ]
        if blocks:
            status = _row(
                "supplier_status",
                "Supplier status",
                "",
                ", ".join(blocks),
                "LFA1",
                "MISMATCH",
                f"The supplier is {' and '.join(blocks)} in SAP.",
            )
        else:
            status = _row(
                "supplier_status",
                "Supplier status",
                "",
                "active",
                "LFA1",
                "MATCH",
                "The supplier is active in SAP.",
            )
        return [row, status]

    def _same_value(
        self, check: str, label: str, invoice_value: Any, sap_value: Any, table: str
    ) -> dict[str, Any]:
        invoice_text, sap_text = _text(invoice_value), _text(sap_value)
        if not invoice_text:
            return _row(
                check,
                label,
                "",
                sap_text,
                table,
                "NOT_ON_INVOICE",
                f"The invoice shows no {label.lower()}.",
            )
        if not sap_text:
            return _row(
                check,
                label,
                invoice_text,
                "",
                table,
                "NOT_COMPARABLE",
                f"SAP has no {label.lower()} for this PO.",
            )
        if invoice_text.casefold() == sap_text.casefold():
            return _row(
                check,
                label,
                invoice_text,
                sap_text,
                table,
                "MATCH",
                f"{label} matches the PO ({sap_text}).",
            )
        return _row(
            check,
            label,
            invoice_text,
            sap_text,
            table,
            "MISMATCH",
            f"In SAP the {label.lower()} is {sap_text}; the invoice says {invoice_text}.",
        )

    def _amount(self, invoice: dict[str, Any], po: dict[str, Any]) -> dict[str, Any]:
        currency = _text(po.get("currency")).upper()
        # PO values in SAP are net (without VAT), so the invoice's net amount is compared;
        # the total is used only when the invoice has no net amount.
        invoice_amount, basis = _money(invoice.get("net_amount")), "net amount"
        if invoice_amount is None:
            invoice_amount, basis = (
                _money(invoice.get("total_amount")),
                "total (no net amount on the invoice)",
            )
        sap_amount = _money(po.get("total_amount"))
        label = "Net amount" if basis == "net amount" else "Amount"
        if invoice_amount is None:
            return _row(
                "amount",
                label,
                "",
                sap_amount,
                "EKPO",
                "NOT_ON_INVOICE",
                "The invoice shows no amount.",
            )
        if sap_amount is None:
            return _row(
                "amount",
                label,
                invoice_amount,
                "",
                "EKPO",
                "NOT_COMPARABLE",
                "The PO's net value is not available in the SAP data.",
            )
        # Each amount keeps its own currency; a currency difference is reported by its own check.
        invoice_currency = _text(invoice.get("currency")).upper() or currency
        invoice_text, sap_text = (
            _amount_text(invoice_amount, invoice_currency),
            _amount_text(sap_amount, currency),
        )
        if abs(invoice_amount - sap_amount) <= AMOUNT_TOLERANCE:
            return _row(
                "amount",
                label,
                invoice_text,
                sap_text,
                "EKPO",
                "MATCH",
                f"The invoice {basis} matches the PO net value ({sap_text}).",
            )
        difference = (
            f" (difference {_amount_text(invoice_amount - sap_amount, currency)})"
            if invoice_currency == currency
            else ""
        )
        return _row(
            "amount",
            label,
            invoice_text,
            sap_text,
            "EKPO",
            "MISMATCH",
            f"In SAP the PO net value is {sap_text}; "
            f"the invoice {basis} is {invoice_text}{difference}.",
        )

    def _invoice_date(self, invoice: dict[str, Any], po: dict[str, Any]) -> dict[str, Any] | None:
        invoice_date, po_date = _date(invoice.get("invoice_date")), _date(po.get("document_date"))
        if po_date is None:
            return None
        if invoice_date is None:
            return _row(
                "invoice_date",
                "Invoice date",
                "",
                po_date,
                "EKKO",
                "NOT_ON_INVOICE",
                "The invoice shows no date.",
            )
        if invoice_date < po_date:
            return _row(
                "invoice_date",
                "Invoice date",
                invoice_date,
                po_date,
                "EKKO",
                "MISMATCH",
                f"The invoice is dated {invoice_date}, before the PO was created ({po_date}).",
            )
        return _row(
            "invoice_date",
            "Invoice date",
            invoice_date,
            po_date,
            "EKKO",
            "MATCH",
            f"The invoice is dated after the PO ({po_date}).",
        )

    def _receipts(self, po_number: str, po: dict[str, Any]) -> list[dict[str, Any]]:
        """Three-way match: a line that expects a goods receipt needs one (or an accepted
        service entry sheet)."""
        rows = []
        sheets = self.finance_reader.get_service_entry_sheets(po_number).get("records", [])
        if sheets:
            pending = [
                _text(sheet["entry_sheet"])
                for sheet in sheets
                if not _text(sheet.get("acceptance")) and not _text(sheet.get("deletion_indicator"))
            ]
            accepted = len(sheets) - len(pending)
            if pending:
                rows.append(
                    _row(
                        "service_entry",
                        "Service entry sheet",
                        "",
                        f"{accepted} of {len(sheets)} accepted",
                        "ESSR",
                        "MISMATCH",
                        f"Service entry sheet(s) {', '.join(pending)} are not accepted in SAP.",
                    )
                )
            else:
                rows.append(
                    _row(
                        "service_entry",
                        "Service entry sheet",
                        "",
                        f"{accepted} accepted",
                        "ESSR",
                        "MATCH",
                        "The service entry sheets for this PO are accepted in SAP.",
                    )
                )

        needing = [
            _text(line["item"])
            for line in po.get("lines", [])
            if line.get("is_active") and _text(line.get("goods_receipt_expected"))
        ]
        if needing:
            received = {
                _text(event["item"]).lstrip("0")
                for event in self.po_reader.get_purchase_order_history(po_number)
                if _text(event.get("history_category")) == "E"
            }
            if sheets:
                received |= {
                    _text(sheet.get("item_number")).lstrip("0")
                    for sheet in sheets
                    if _text(sheet.get("acceptance"))
                }
            missing = [item for item in needing if item.lstrip("0") not in received]
            if missing:
                rows.append(
                    _row(
                        "goods_receipt",
                        "Goods receipt",
                        "",
                        f"{len(needing) - len(missing)} of {len(needing)} line(s)",
                        "EKBE",
                        "MISMATCH",
                        f"No goods receipt in SAP for PO line(s) {', '.join(missing)}.",
                    )
                )
            else:
                rows.append(
                    _row(
                        "goods_receipt",
                        "Goods receipt",
                        "",
                        "1 line" if len(needing) == 1 else f"all {len(needing)} lines",
                        "EKBE",
                        "MATCH",
                        "Goods receipts are posted in SAP for every PO line that needs one.",
                    )
                )
        return rows

    def _account_assignments(self, po_number: str) -> list[dict[str, Any]]:
        """The GL accounts and cost centers the PO lines post to must exist and be usable."""
        records = [
            record
            for record in self.finance_reader.get_po_account_assignments(po_number).get(
                "records", []
            )
            if not _text(record.get("deletion_indicator"))
        ]
        rows = []
        gl_accounts = sorted(
            {_text(record["gl_account"]) for record in records if _text(record.get("gl_account"))}
        )
        if gl_accounts:
            problems = []
            for account in gl_accounts:
                found = self.finance_reader.find_gl_account(account)["records"]
                if not found:
                    problems.append(f"GL account {account} is not in the SAP chart of accounts")
                elif all(
                    _text(item.get("blocked_for_posting")) or _text(item.get("mark_for_deletion"))
                    for item in found
                ):
                    problems.append(
                        f"GL account {account} is blocked or marked for deletion in SAP"
                    )
            rows.append(
                _row(
                    "gl_account",
                    "GL account",
                    "",
                    ", ".join(gl_accounts),
                    "EKKN · SKA1",
                    "MISMATCH" if problems else "MATCH",
                    "; ".join(problems) + "." if problems else "The PO's GL accounts exist in SAP.",
                )
            )

        cost_centers = sorted(
            {
                (_text(record.get("controlling_area")), _text(record["cost_center"]))
                for record in records
                if _text(record.get("cost_center"))
            }
        )
        if cost_centers:
            problems = []
            for area, cost_center in cost_centers:
                found = self._cost_center(area, cost_center)
                if not found:
                    problems.append(f"Cost center {cost_center} is not in SAP")
                elif all(
                    (_date(item.get("valid_to")) or date.max) < date.today() for item in found
                ):
                    problems.append(f"Cost center {cost_center} is no longer valid in SAP")
            rows.append(
                _row(
                    "cost_center",
                    "Cost center",
                    "",
                    ", ".join(cc for _, cc in cost_centers),
                    "EKKN · CSKS",
                    "MISMATCH" if problems else "MATCH",
                    "; ".join(problems) + "."
                    if problems
                    else "The PO's cost centers exist in SAP.",
                )
            )
        return rows

    def _cost_center(self, controlling_area: str, cost_center: str) -> list[dict[str, Any]]:
        for candidate in dict.fromkeys(
            [cost_center, cost_center.zfill(10), cost_center.lstrip("0")]
        ):
            found = self.finance_reader.get_cost_center(controlling_area, candidate).get(
                "records", []
            )
            if found:
                return found
        return []

    def _bank(self, po: dict[str, Any]) -> dict[str, Any] | None:
        supplier_id = _text(po.get("supplier_id"))
        if not supplier_id:
            return None
        details = self.finance_reader.get_vendor_bank_details(supplier_id)
        if details.get("status") != "FOUND":
            return _row(
                "bank",
                "Bank account",
                "",
                "none",
                "LFBK",
                "NOT_IN_SAP",
                "SAP has no bank account on file for this supplier.",
            )
        record = details["records"][0]
        bank_name = next(
            (
                _text(bank.get("bank_name"))
                for bank in record.get("bank_records", [])
                if bank.get("bank_name")
            ),
            "",
        )
        account = _text(record.get("bank_account"))
        # Only the last digits are shown; the full account number stays in SAP.
        masked = f"···{account[-4:]}" if account else ""
        return _row(
            "bank",
            "Bank account",
            "",
            " ".join(filter(None, [bank_name, masked])),
            "LFBK · BNKA",
            "MATCH",
            f"SAP has {details['record_count']} bank account(s) on file for this supplier.",
        )
