import os, tempfile, json, httpx
os.environ["AP_DB"] = tempfile.mktemp(suffix=".db")
from fastapi.testclient import TestClient
from app.main import app
from app import document
P = {"X-User": "aisha", "X-Role": "processor"}
def txt(no, net="10000.00", vat="1500.00", vendor="Gulf Aviation Fuel Co", po="4500012345"):
    return f"Vendor: {vendor}\nInvoice No: {no}\nNet: {net}\nVAT: {vat}\nPO: {po}\n".encode()
def test_upload_extract_then_decide():
    with TestClient(app) as t:
        r = t.post("/api/v1/cases/upload", files={"file": ("a.txt", txt("INV-8001"))}, headers=P).json()
        assert r["status"] == "EXTRACTED" and r["vendor"] == "V100"
        assert t.post(f"/api/v1/cases/{r['id']}/decide", headers=P).json()["judgement"]["act"] == "POST"
def test_low_confidence_blocks_until_human_review():
    with TestClient(app) as t:
        r = t.post("/api/v1/cases/upload", files={"file": ("b.txt", txt("INV-8002", net="10000.00?"))}, headers=P).json()
        assert r["status"] == "NEEDS_REVIEW"
        assert t.post(f"/api/v1/cases/{r['id']}/decide", headers=P).status_code == 409
        assert t.post(f"/api/v1/cases/{r['id']}/review", json={"net": "10000.00"}, headers=P).json()["status"] == "EXTRACTED"
def test_unsafe_file_rejected():
    with TestClient(app) as t:
        assert t.post("/api/v1/cases/upload", files={"file": ("x.exe", b"MZ\x90\x00")}, headers=P).status_code == 415
def test_sap_client_request_flow(monkeypatch):
    seen = []
    def handler(req):
        seen.append((req.method, req.url.path))
        if req.url.path == "/oauth/token": return httpx.Response(200, json={"access_token": "tok"})
        assert req.headers["authorization"] == "Bearer tok"
        if req.method == "POST": return httpx.Response(202, json={"id": "job1", "status": "PENDING"})
        return httpx.Response(200, json={"status": "DONE", "extraction": {"headerFields": [
            {"name": "documentNumber", "value": "INV-1", "confidence": 0.99}, {"name": "netAmount", "value": 100, "confidence": 0.9}]}})
    monkeypatch.setenv("DOC_AI_SERVICE_KEY", json.dumps({"url": "https://die.example", "uaa": {"url": "https://auth.example", "clientid": "i", "clientsecret": "s"}}))
    out = document.SapDocumentAI(transport=httpx.MockTransport(handler)).extract(b"%PDF-1", "i.pdf", "application/pdf")
    assert out["inv_no"]["value"] == "INV-1" and out["net"]["confidence"] == 0.9
    assert ("POST", "/document-information-extraction/v1/document/jobs") in seen
