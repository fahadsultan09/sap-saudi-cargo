"""Full two-service path in one process: AP Core -> agent runtime -> AP Core tool gateway."""
import os, sys, tempfile, time, json, httpx, pytest
os.environ["AP_DB"] = tempfile.mktemp(suffix=".db")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "agent-runtime"))
from fastapi.testclient import TestClient
from app.main import app as core
from app import toolauth, agent_runner as ar, db
import agent_app.main as rt
P = {"X-User": "aisha", "X-Role": "processor"}
@pytest.fixture
def remote(monkeypatch):
    for k, v in dict(AGENT_MODE="remote", TOOL_TOKEN_SECRET="s3cret", RUNTIME_API_KEY="k", AP_CORE_URL="http://core", AGENT_RUNTIME_URL="http://rt").items(): monkeypatch.setenv(k, v)
    with TestClient(core) as core_c:
        monkeypatch.setattr(rt, "get_gateway_http", lambda: TestClient(core, base_url="http://core"))
        monkeypatch.setattr(ar, "runtime_http", lambda: TestClient(rt.app, base_url="http://rt"))
        yield core_c
def mk(c, no, net, vat, po, v="V100"):
    cid = c.post("/api/v1/cases", json={"vendor": v, "inv_no": no, "net": net, "vat": vat, "po": po}, headers=P).json()["id"]
    return c.post(f"/api/v1/cases/{cid}/decide", headers=P).json()
def test_token_roundtrip_tamper_expiry(monkeypatch):
    monkeypatch.setenv("TOOL_TOKEN_SECRET", "s"); t, cl = toolauth.issue(1, "P", "V", ["get_po"]); assert toolauth.verify(t)["jti"] == cl["jti"]
    b, s = t.split("."); [pytest.raises(toolauth.BadToken, toolauth.verify, x) for x in (b + "." + s[:-2] + "AA", "junk", toolauth.issue(1, "P", "V", [], ttl=-5)[0])]
    monkeypatch.setenv("TOOL_TOKEN_SECRET", "other"); pytest.raises(toolauth.BadToken, toolauth.verify, t)
def test_gateway_rules(remote):
    tok, _ = toolauth.issue(7, "4500012345", "V100", ["get_po", "vendor_history"]); H = {"Authorization": "Bearer " + tok}
    assert remote.post("/internal/v1/tools/get_po", json={"po": "4500012345"}, headers=H).status_code == 200
    assert remote.post("/internal/v1/tools/get_po", json={"po": "4500012346"}, headers=H).status_code == 403      # another case's PO
    assert remote.post("/internal/v1/tools/get_goods_receipts", json={"po": "4500012345"}, headers=H).status_code == 403  # not in token
    assert remote.post("/internal/v1/tools/post_to_sap", json={}, headers=H).status_code == 403
    assert remote.post("/internal/v1/tools/get_po", json={"po": "4500012345"}, headers={"Authorization": "Bearer junk"}).status_code == 401
    assert remote.post("/internal/v1/tools/get_po", json={"po": "4500012345"}).status_code == 422
def test_full_remote_investigation(remote):
    r = mk(remote, "INV-R1", "10782.61", "1617.39", "4500012345"); j = r["judgement"]
    assert j["source"] == "agent" and j["act"] == "POST" and j["amount"] == "12400.00" and any(t.startswith("get_po(") for t in j["trace"])
    c = db.connect(); rows = c.execute("SELECT name FROM tool_call WHERE case_id=?", (r["id"],)).fetchall(); c.close(); assert {x["name"] for x in rows} >= {"get_po", "vendor_history"}
    ev = remote.get(f"/api/v1/events?case_id={r['id']}", headers=P).json(); assert any("get_po" in e["text"] for e in ev if e["kind"] == "MODEL_JUDGEMENT")
def test_remote_hold_case(remote):
    r = mk(remote, "INV-R2", "6956.52", "1043.48", "4500012346", "V200"); assert r["judgement"]["act"] == "HOLD" and r["status"] == "WAITING_EXTERNAL"
def test_clean_case_never_calls_runtime(remote, monkeypatch):
    monkeypatch.setattr(ar, "runtime_http", lambda: (_ for _ in ()).throw(AssertionError("runtime called")))
    assert mk(remote, "INV-R3", "10000", "1500", "4500012345")["judgement"]["source"] == "rules"
def test_runtime_down_falls_back(remote, monkeypatch):
    def boom(req): raise httpx.ConnectError("down")
    monkeypatch.setattr(ar, "runtime_http", lambda: httpx.Client(base_url="http://rt", transport=httpx.MockTransport(boom)))
    j = mk(remote, "INV-R4", "10782.61", "1617.39", "4500012345")["judgement"]; assert j["source"] == "rules (agent fallback)" and "runtime error" in j["trace"][-1]
def test_runtime_claiming_an_answer_without_lookups_is_rejected(remote, monkeypatch):
    lie = {"final": {"action": "POST", "amount": "12400.00", "summary": "trust me", "evidence": ["PO 4500012345 allows it"], "confidence": 0.99}, "trace": [], "steps": 1, "error": None}
    monkeypatch.setattr(ar, "runtime_http", lambda: httpx.Client(base_url="http://rt", transport=httpx.MockTransport(lambda r: httpx.Response(200, json=lie))))
    j = mk(remote, "INV-R5", "10782.61", "1617.39", "4500012345")["judgement"]; assert j["source"] == "rules (agent fallback)" and "no lookups" in j["trace"][-1]
def test_runtime_needs_service_key(remote):
    assert TestClient(rt.app).post("/v1/investigate", json={"case": {}, "token": "x"}, headers={"X-Service-Key": "wrong"}).status_code == 401
