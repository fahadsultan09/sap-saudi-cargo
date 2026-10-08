"""Agent layer. Advice only. Replace recommend() with a call to SAP AI Core (set AI_CORE_URL). It has no write path."""
from decimal import Decimal as D
def recommend(inv, po, rules):
    res = {r[0]: r[1] for r in rules}
    gross = D(inv["net"]) + D(inv["vat"])
    if res["DUPLICATE"] == "FAIL": return {"act": "REJECT", "amount": "0", "text": "Reject as duplicate.", "conf": 0.99}
    if "UNKNOWN" in res.values(): return {"act": "HOLD", "amount": "0", "text": "Hold, ask warehouse for goods receipt.", "conf": 0.9}
    if res["TOLERANCE_2PCT"] == "FAIL": return {"act": "POST", "amount": str(po["amount"]), "text": f"Post at PO value, request credit note {gross - po['amount']}.", "conf": 0.82}
    if "FAIL" in res.values(): return {"act": "REJECT", "amount": "0", "text": "Reject, hard rule failed.", "conf": 0.9}
    return {"act": "POST", "amount": str(gross), "text": "Post as submitted.", "conf": 0.97}
