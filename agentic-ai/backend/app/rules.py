"""Deterministic rules. Plain code, Decimal only. A model result never changes a rule result."""
from decimal import Decimal as D
TOL = D("0.02")
def run(inv, po, vendor, posted):
    R = []
    dup = next((p for p in posted if p["vendor"] == inv["vendor"] and p["inv_no"] == inv["inv_no"]), None)
    R.append(("DUPLICATE", "FAIL" if dup else "PASS", f"matches SAP doc {dup['doc']}" if dup else "no match in SAP"))
    R.append(("VENDOR_ACTIVE", "PASS" if vendor and vendor["active"] else "FAIL", vendor["name"] if vendor else "unknown vendor"))
    net, vat = D(inv["net"]), D(inv["vat"])
    R.append(("VAT_15", "PASS" if abs(vat - net * D("0.15")) < D("0.02") else "FAIL", f"expected {net*D('0.15'):.2f}, got {vat}"))
    R.append(("PO_EXISTS", "PASS" if po else "UNKNOWN", inv["po"]))
    gross = net + vat
    gr = po["gr"] if po else None
    R.append(("GR_MATCH", "UNKNOWN" if gr is None else ("PASS" if gr >= gross else "FAIL"), f"gr={gr} gross={gross}"))
    if po:
        dev = abs(gross - po["amount"]) / po["amount"]
        R.append(("TOLERANCE_2PCT", "PASS" if dev <= TOL else "FAIL", f"deviation {dev*100:.1f}%"))
    else:
        R.append(("TOLERANCE_2PCT", "UNKNOWN", "no PO"))
    return R
