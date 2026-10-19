"""SOURCE_CHECK against the SAP Excel exports, using the PO data maintained for the test invoices."""
import pytest

from agents.source_check import SourceCheckAgent
from integrations.excel_sap_finance_reader import ExcelSAPFinanceReader
from integrations.excel_sap_reader import ExcelSAPReadOnlyReader


@pytest.fixture(scope="module")
def agent():
    return SourceCheckAgent(ExcelSAPReadOnlyReader(), ExcelSAPFinanceReader())


def invoice(po, supplier, currency, net, date):
    return {"po_number": po, "supplier_name": supplier, "currency": currency, "net_amount": net, "invoice_date": date}


def test_matching_invoice_gets_an_approve_right_away_verdict(agent):
    verdict = agent.run(invoice("4500012345", "Gulf Aviation Supplies Co.", "SAR", "57500.00", "2026-10-01"))
    assert verdict["status"] == "MATCH"
    assert verdict["discrepancies"] == []
    assert "approve right away" in verdict["summary"]


def test_amount_difference_is_reported_with_both_values(agent):
    verdict = agent.run(invoice("4500012601", "Coastline Aviation Fuel Services", "SAR", "1500000", "2026-10-12"))
    assert verdict["status"] == "MISMATCH"
    assert verdict["discrepancies"] == [
        "In SAP the PO net value is 100,000.00 SAR; the invoice net amount is 1,500,000.00 SAR "
        "(difference 1,400,000.00 SAR)."
    ]


def test_every_check_differs_for_a_no_match_invoice(agent):
    verdict = agent.run(invoice("4500012701", "Najd Catering Company", "SAR", "28800", "2026-10-16"))
    assert verdict["status"] == "MISMATCH"
    assert not [row for row in verdict["comparisons"] if row["result"] == "MATCH"]
    assert len(verdict["discrepancies"]) == 10


def test_unknown_or_missing_po_is_not_found(agent):
    assert agent.run(invoice("", "Any Supplier", "SAR", "100", "2026-10-01"))["status"] == "NOT_FOUND"
    assert agent.run(invoice("9999999999", "Any Supplier", "SAR", "100", "2026-10-01"))["status"] == "NOT_FOUND"


def test_missing_amount_leaves_the_check_incomplete(agent):
    verdict = agent.run(invoice("4500012345", "Gulf Aviation Supplies Co.", "SAR", "", "2026-10-01"))
    assert verdict["status"] == "INCOMPLETE"
