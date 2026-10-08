import os, tempfile, json, httpx
os.environ["AP_DB"] = tempfile.mktemp(suffix=".db")
from fastapi.testclient import TestClient
from app.main import app
from app import llm, db, agent_runner, rules, sap
P = {"X-User": "aisha", "X-Role": "processor"}
def mk(t, no, net, vat, po, v="V100"):
    cid = t.post("/api/v1/cases", json={"vendor": v, "inv_no": no, "net": net, "vat": vat, "po": po}, headers=P).json()["id"]
    return t.post(f"/api/v1/cases/{cid}/decide", headers=P).json()
def test_agent_finds_approved_surcharge():
    with TestClient(app) as t:
        r = mk(t, "INV-A1", "10782.61", "1617.39", "4500012345")
        j = r["judgement"]; assert j["source"] == "agent" and j["act"] == "POST" and j["amount"] == "12400.00" and len(j["evidence"]) >= 2
        assert any(e["kind"] == "MODEL_JUDGEMENT" and "get_po" in e["text"] for e in t.get(f"/api/v1/events?case_id={r['id']}", headers=P).json())
def test_agent_holds_when_receipt_missing():
    with TestClient(app) as t:
        r = mk(t, "INV-A2", "6956.52", "1043.48", "4500012346", "V200"); assert r["judgement"]["act"] == "HOLD" and r["status"] == "WAITING_EXTERNAL"
def test_clean_case_uses_no_model():
    with TestClient(app) as t: assert mk(t, "INV-A3", "10000", "1500", "4500012345")["judgement"]["source"] == "rules"
class Fake:
    def __init__(s, *replies): s.r = list(replies)
    def chat(s, m): return s.r.pop(0)
def run_fake(*replies):
    db.init(); c = db.connect(); inv = {"vendor": "V100", "inv_no": "X", "net": "10782.61", "vat": "1617.39", "po": "4500012345"}; po = sap.read_po(inv["po"])
    R = rules.run(inv, po, sap.read_vendor("V100"), []); out = agent_runner.advise(c, inv, po, R, llm=Fake(*replies)); c.close(); return out
def test_write_tool_is_refused_and_bad_amount_discarded():
    j, tr = run_fake(json.dumps({"tool": "post_to_sap", "args": {}}), json.dumps({"final": {"action": "POST", "amount": "99999", "summary": "x", "evidence": ["e"], "confidence": 0.9}}))
    assert any("REFUSED" in x for x in tr) and j["source"] == "rules (agent fallback)" and "guard" in tr[-1]
def test_garbage_reply_falls_back():
    j, tr = run_fake("hello", "still not json", "nope", "nope", "nope", "nope"); assert j["source"] == "rules (agent fallback)"
def test_aicore_client_request_shape(monkeypatch):
    seen = {}
    def h(req):
        if req.url.path == "/oauth/token": return httpx.Response(200, json={"access_token": "tok"})
        seen.update(path=req.url.path, rg=req.headers["ai-resource-group"], auth=req.headers["authorization"], q=dict(req.url.params)); return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})
    monkeypatch.setenv("AICORE_SERVICE_KEY", json.dumps({"url": "https://auth.example", "clientid": "i", "clientsecret": "s"})); monkeypatch.setenv("AICORE_DEPLOYMENT_URL", "https://api.example/v2/inference/deployments/d1"); monkeypatch.setenv("AICORE_RESOURCE_GROUP", "rg1")
    assert llm.AICoreLLM(transport=httpx.MockTransport(h)).chat([{"role": "user", "content": "hi"}]) == "{}"
    assert seen["path"].endswith("/d1/chat/completions") and seen["rg"] == "rg1" and seen["auth"] == "Bearer tok" and "api-version" in seen["q"]
