import json, httpx, pytest
from agent_app.loop import investigate
PO = "4500012345"; CASE = {"vendor": "V100", "inv_no": "X", "net": "10782.61", "vat": "1617.39", "po": PO, "gross": "12400.00", "rules": {}}
class Fake:
    def __init__(s, *r): s.r = list(r); s.calls = 0
    def chat(s, m):
        s.calls += 1; x = s.r.pop(0)
        if isinstance(x, Exception): raise x
        return x
def tool(n, **a): return json.dumps({"tool": n, "args": a})
def fin(action="HOLD", ev=None, conf=0.8): return json.dumps({"final": {"action": action, "amount": "0", "summary": "s", "evidence": ev or ["PO " + PO], "confidence": conf}})
def gw(name, args): return True, {"po": PO, "amount": "11500"}
def test_happy_path_in_prose_and_fences():
    out = investigate(CASE, gw, Fake("ok\n```json\n" + tool("get_po", po=PO) + "\n```", fin())); assert out["final"]["action"] == "HOLD" and out["error"] is None
def test_final_before_lookup_sent_back():
    out = investigate(CASE, gw, Fake(fin(), tool("get_po", po=PO), fin())); assert out["final"] and "asked to look up first" in out["trace"][0]
def test_gateway_refusal_is_fed_back_and_logged():
    calls = []
    def g(n, a): calls.append(a); return (False, "403 out of scope") if len(calls) == 1 else (True, {})
    out = investigate(CASE, g, Fake(tool("get_po", po="9"), tool("get_po", po=PO), fin())); assert "REFUSED get_po" in out["trace"][0] and out["final"]
def test_write_tool_refused_without_calling_gateway():
    calls = []; out = investigate(CASE, lambda n, a: calls.append(n) or (True, {}), Fake(tool("post_to_sap"), tool("get_po", po=PO), fin())); assert "REFUSED tool 'post_to_sap'" in out["trace"][0] and calls == ["get_po"]
def test_repeat_call_skipped():
    out = investigate(CASE, gw, Fake(tool("get_po", po=PO), tool("get_po", po=PO), fin())); assert "repeat call skipped: get_po" in out["trace"]
@pytest.mark.parametrize("bad", [fin(conf=2), json.dumps({"final": "post it"}), fin("PAY")])
def test_bad_schema(bad):
    out = investigate(CASE, gw, Fake(tool("get_po", po=PO), bad)); assert out["final"] is None and "schema" in out["error"]
def test_retry_on_transient_error_but_not_on_401(monkeypatch):
    monkeypatch.setenv("AGENT_RETRY_SECS", "0"); f = Fake(httpx.ConnectError("x"), tool("get_po", po=PO), fin()); assert investigate(CASE, gw, f)["final"] and f.calls == 3
    e = httpx.HTTPStatusError("x", request=httpx.Request("POST", "http://x"), response=httpx.Response(401)); f = Fake(e, "unused"); out = investigate(CASE, gw, f); assert out["final"] is None and f.calls == 1
def test_timeout_and_step_limit(monkeypatch):
    monkeypatch.setenv("AGENT_TIMEOUT", "-1"); assert investigate(CASE, gw, Fake())["error"] == "timeout"
    monkeypatch.setenv("AGENT_TIMEOUT", "60"); monkeypatch.setenv("AGENT_MAX_STEPS", "2"); out = investigate(CASE, gw, Fake(tool("get_po", po=PO), tool("get_goods_receipts", po=PO))); assert out["error"] == "step limit reached"
