import os, tempfile
os.environ["AP_DB"] = tempfile.mktemp(suffix=".db")
from fastapi.testclient import TestClient
from app.main import app
P = {"X-User": "aisha", "X-Role": "processor"}; A = {"X-User": "omar", "X-Role": "approver"}
def inv(no, net, vat, po, v="V100"): return {"vendor": v, "inv_no": no, "net": net, "vat": vat, "po": po}
def test_clean_flow_posts_once():
    with TestClient(app) as t:
        cid = t.post("/api/v1/cases", json=inv("INV-7781", "10000", "1500", "4500012345"), headers=P).json()["id"]
        assert t.post(f"/api/v1/cases/{cid}/decide", headers=P).json()["judgement"]["act"] == "POST"
        t.post(f"/api/v1/cases/{cid}/confirm", headers=P); t.post(f"/api/v1/cases/{cid}/approve", headers=A)
        assert t.post(f"/internal/v1/dispatch/{cid}/post", headers=A).status_code == 200
        assert t.post(f"/internal/v1/dispatch/{cid}/post", headers=A).status_code == 409
        assert t.post(f"/internal/v1/dispatch/{cid}/reconcile", headers=A).json()["status"] == "CLOSED"
def test_duplicate_rejected_and_hold():
    with TestClient(app) as t:
        d = t.post("/api/v1/cases", json=inv("INV-5520", "4000", "600", "4500012347"), headers=P).json()["id"]
        assert t.post(f"/api/v1/cases/{d}/decide", headers=P).json()["judgement"]["act"] == "REJECT"
        h = t.post("/api/v1/cases", json=inv("INV-9001", "6956.52", "1043.48", "4500012346", "V200"), headers=P).json()["id"]
        assert t.post(f"/api/v1/cases/{h}/decide", headers=P).json()["status"] == "WAITING_EXTERNAL"
def test_segregation_of_duties_and_roles():
    with TestClient(app) as t:
        cid = t.post("/api/v1/cases", json=inv("INV-7782", "10782.61", "1617.39", "4500012345"), headers=P).json()["id"]
        t.post(f"/api/v1/cases/{cid}/decide", headers=P)
        both = {"X-User": "omar", "X-Role": "processor"}; t.post(f"/api/v1/cases/{cid}/confirm", headers=both)
        assert t.post(f"/api/v1/cases/{cid}/approve", headers=A).status_code == 403
        assert t.post(f"/internal/v1/dispatch/{cid}/post", headers=P).status_code == 403
