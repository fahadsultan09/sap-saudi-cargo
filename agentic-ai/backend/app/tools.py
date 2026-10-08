"""Tool gateway. The agent can only call what is listed in TOOLS, and every tool is read-only. There is no write tool on purpose."""
from . import sap
def get_po(c, po):
    p = sap.read_po(po)
    return None if not p else {"po": po, "vendor": p["vendor"], "amount": str(p["amount"]), "gr_total": None if p["gr"] is None else str(p["gr"]), "change_log": sap.PO_CHANGES.get(po, [])}
def get_goods_receipts(c, po): return {"posted": sap.GOODS_RECEIPTS.get(po, []), "delivery_notes": sap.DELIVERY_NOTES.get(po, [])}
def vendor_history(c, vendor): return sap.VENDOR_HISTORY.get(vendor, [])
def find_similar_cases(c, vendor):
    return [dict(r) for r in c.execute("SELECT inv_no,status FROM ap_case WHERE vendor=? AND status IN ('CLOSED','REJECTED') LIMIT 5", (vendor,))]
TOOLS = {"get_po": get_po, "get_goods_receipts": get_goods_receipts, "vendor_history": vendor_history, "find_similar_cases": find_similar_cases}
