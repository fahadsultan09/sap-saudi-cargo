"""Model access. AGENT_MODE=stub (default, scripted), aicore (SAP AI Core deployment), off (rules only)."""
import os, json, httpx
class AICoreLLM:
    """Calls an AI Core model deployment: POST {deployment_url}/chat/completions with Bearer token and AI-Resource-Group header.
    Needs AICORE_SERVICE_KEY (json), AICORE_DEPLOYMENT_URL, optional AICORE_RESOURCE_GROUP, AICORE_API_VERSION."""
    def __init__(self, transport=None):
        self.k = json.loads(os.environ["AICORE_SERVICE_KEY"]); self.http = httpx.Client(transport=transport, timeout=60)
    def chat(self, msgs):
        t = self.http.post(self.k["url"].rstrip("/") + "/oauth/token", data={"grant_type": "client_credentials"}, auth=(self.k["clientid"], self.k["clientsecret"]))
        t.raise_for_status()
        r = self.http.post(os.environ["AICORE_DEPLOYMENT_URL"].rstrip("/") + "/chat/completions", params={"api-version": os.getenv("AICORE_API_VERSION", "2023-05-15")},
            headers={"Authorization": "Bearer " + t.json()["access_token"], "AI-Resource-Group": os.getenv("AICORE_RESOURCE_GROUP", "default")},
            json={"messages": msgs, "max_tokens": 800, "temperature": 0})
        r.raise_for_status(); return r.json()["choices"][0]["message"]["content"]
class StubLLM:
    """Scripted stand-in that still reads the real tool results, so the trace and evidence are genuine."""
    def chat(self, msgs):
        case = json.loads(msgs[1]["content"]); done = {}
        for m in msgs:
            if m["role"] == "user" and m["content"].startswith("TOOL_RESULT"): d = json.loads(m["content"].split(": ", 1)[1]); done[d["tool"]] = d["result"]
        if "get_po" not in done: return json.dumps({"tool": "get_po", "args": {"po": case["po"]}})
        if "get_goods_receipts" not in done: return json.dumps({"tool": "get_goods_receipts", "args": {"po": case["po"]}})
        if "vendor_history" not in done: return json.dumps({"tool": "vendor_history", "args": {"vendor": case["vendor"]}})
        po, gr = done["get_po"], done["get_goods_receipts"]; gross = float(case["gross"]); ev = []
        if not gr["posted"] and gr["delivery_notes"]:
            ev = ["No goods receipt posted for PO " + case["po"], "Delivery note: " + gr["delivery_notes"][0]["note"]]
            return json.dumps({"final": {"action": "HOLD", "amount": "0", "summary": "Goods arrived but the receipt is not posted. Ask the warehouse to post it, then re-run.", "evidence": ev, "confidence": 0.88}})
        diff = round(gross - float(po["amount"]), 2); ch = [x for x in po["change_log"] if "surcharge" in x["note"].lower()]
        if diff > 0 and ch:
            ev = [f"Invoice exceeds PO by {diff:.2f}", "PO change log: " + ch[0]["note"], "Vendor history shows an earlier surcharge later covered by an amendment"]
            return json.dumps({"final": {"action": "POST", "amount": f"{gross:.2f}", "summary": "The extra amount matches an approved surcharge. Post in full and make sure the PO amendment is completed.", "evidence": ev, "confidence": 0.84}})
        return json.dumps({"final": {"action": "POST", "amount": str(po["amount"]), "summary": f"No support found for the {diff:.2f} difference. Post at PO value and ask the vendor for a credit note.", "evidence": [f"Invoice exceeds PO by {diff:.2f}", "No change log entry explains it"], "confidence": 0.7}})
def get_llm():
    m = os.getenv("AGENT_MODE", "stub")
    return AICoreLLM() if m == "aicore" else StubLLM()
