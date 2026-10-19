import hashlib
from fastapi.testclient import TestClient
import ap_core.db as db
import ap_core.main as main
from ap_core.main import app


def setup_client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "ap_core_test.sqlite3")
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "ap_core_test.sqlite3")
    return TestClient(app)


def register(client, content=b"pdf-bytes", name="invoice.pdf"):
    return client.post("/internal/v1/cases/register-upload", json={
        "source":"test", "file_name":name, "sha256":hashlib.sha256(content).hexdigest(),
        "document_ref":"test://doc/1", "created_by":"pytest"
    })


def test_exact_duplicate_returns_existing_case_and_no_second_work(tmp_path, monkeypatch):
    with setup_client(tmp_path, monkeypatch) as client:
        first=register(client)
        second=register(client, name="renamed-invoice.pdf")
        assert first.status_code==200 and second.status_code==200
        assert first.json()["case_id"]==second.json()["case_id"]
        assert first.json()["duplicate"] is False
        assert second.json()["duplicate"] is True
        with db.connect() as c:
            assert c.execute("SELECT COUNT(*) FROM cases").fetchone()[0]==1
            assert c.execute("SELECT COUNT(*) FROM work_items").fetchone()[0]==1
            assert c.execute("SELECT COUNT(*) FROM audit_events WHERE event_type='DUPLICATE_UPLOAD_DETECTED'").fetchone()[0]==1


def test_agent_judgement_does_not_change_business_state(tmp_path, monkeypatch):
    with setup_client(tmp_path, monkeypatch) as client:
        case=register(client).json()["case_id"]
        r=client.post(f"/internal/v1/cases/{case}/agent-judgements", json={
            "agent_name":"TOWER","judgement_type":"CLASSIFICATION","payload":{"document_type":"invoice"},
            "idempotency_key":"tower-classification-v1"
        })
        assert r.status_code==200
        assert r.json()["state_changed"] is False
        assert client.get(f"/api/v1/cases/{case}").json()["status"]=="RECEIVED"


def test_extraction_routes_to_review_on_business_duplicate(tmp_path, monkeypatch):
    with setup_client(tmp_path, monkeypatch) as client:
        first=register(client, b"invoice-one").json()["case_id"]
        fields={"invoice_number":"INV-42","supplier_id":"SUP-1","supplier_name":"Supplier A","company_code":"1000","currency":"SAR","total_amount":"12500.00"}
        result=client.post(f"/internal/v1/cases/{first}/extraction-result",json={"fields":fields,"idempotency_key":"extract-case-one-v1"})
        assert result.status_code==200 and result.json()["status"]=="READY_FOR_APPROVAL"
        second=register(client, b"invoice-two").json()["case_id"]
        result2=client.post(f"/internal/v1/cases/{second}/extraction-result",json={"fields":fields,"idempotency_key":"extract-case-two-v1"})
        assert result2.status_code==200
        assert result2.json()["status"]=="NEEDS_REVIEW"
        assert result2.json()["business_duplicate"]["matched_case_id"]==first


def test_work_item_lease_and_completion(tmp_path, monkeypatch):
    with setup_client(tmp_path, monkeypatch) as client:
        case=register(client).json()["case_id"]
        lease=client.post("/internal/v1/work-items/lease",json={"worker_id":"worker-1"})
        assert lease.status_code==200
        work=lease.json()["work_item"]
        assert work["case_id"]==case
        done=client.post(f"/internal/v1/work-items/{work['id']}/complete",json={"worker_id":"worker-1","outcome":"SUCCEEDED","idempotency_key":"complete-work-item-v1"})
        assert done.status_code==200 and done.json()["status"]=="SUCCEEDED"


def test_transition_rejects_skipping_approval(tmp_path, monkeypatch):
    with setup_client(tmp_path, monkeypatch) as client:
        case=register(client).json()["case_id"]
        r=client.post(f"/internal/v1/cases/{case}/transition",json={"target_status":"POSTED","actor":"worker","reason":"skip","idempotency_key":"illegal-transition-v1"})
        assert r.status_code==409


PROCESSOR={"X-User-Id":"faizan","X-User-Role":"AP_PROCESSOR"}
APPROVER={"X-User-Id":"sara","X-User-Role":"FINANCE_MANAGER"}
FIELDS={"invoice_number":"INV-77","supplier_name":"Supplier B","company_code":"1000","currency":"sar","total_amount":"980.50"}


def upload(client, content=b"%PDF-1.4 test invoice"):
    return client.post("/api/v1/cases/upload", headers=PROCESSOR, files={"file":("invoice.pdf",content,"application/pdf")})


def test_upload_records_the_signed_in_user_and_serves_the_document(tmp_path, monkeypatch):
    with setup_client(tmp_path, monkeypatch) as client:
        case=upload(client).json()["case_id"]
        assert client.get(f"/api/v1/cases/{case}").json()["created_by"]=="faizan"
        doc=client.get(f"/api/v1/cases/{case}/document")
        assert doc.status_code==200 and doc.content.startswith(b"%PDF-")
        assert upload(client, b"%PDF-1.4 other").status_code==200
        assert client.post("/api/v1/cases/upload", headers=APPROVER, files={"file":("x.pdf",b"%PDF-x","application/pdf")}).status_code==403


def test_field_correction_reroutes_the_case(tmp_path, monkeypatch):
    with setup_client(tmp_path, monkeypatch) as client:
        case=register(client).json()["case_id"]
        client.post(f"/internal/v1/cases/{case}/extraction-result",json={"fields":{"invoice_number":"INV-77"},"idempotency_key":"extract-partial-v1"})
        assert client.get(f"/api/v1/cases/{case}").json()["status"]=="NEEDS_REVIEW"
        r=client.patch(f"/api/v1/cases/{case}/fields",headers=PROCESSOR,json={"fields":FIELDS,"comment":"Checked against PDF"})
        assert r.status_code==200 and r.json()["status"]=="READY_FOR_APPROVAL"
        saved=client.get(f"/api/v1/cases/{case}").json()
        assert saved["currency"]=="SAR" and saved["last_edited_by"]=="faizan"
        assert saved["validation"]["agents_completed"] is True
        bad=client.patch(f"/api/v1/cases/{case}/fields",headers=PROCESSOR,json={"fields":{"total_amount":"abc"},"comment":"typo"})
        assert bad.status_code==409


def test_approval_needs_an_independent_approver(tmp_path, monkeypatch):
    with setup_client(tmp_path, monkeypatch) as client:
        case=register(client).json()["case_id"]
        client.post(f"/internal/v1/cases/{case}/extraction-result",json={"fields":FIELDS,"idempotency_key":"extract-full-v1"})
        assert client.post(f"/api/v1/cases/{case}/approve",headers=PROCESSOR,json={"comment":"looks fine"}).status_code==403
        r=client.post(f"/api/v1/cases/{case}/approve",headers=APPROVER,json={})
        assert r.status_code==200 and r.json()["status"]=="APPROVED"
        events=[e["event_type"] for e in client.get(f"/api/v1/cases/{case}/history").json()["items"]]
        assert events[-2:]==["STATE_TRANSITION","APPROVAL_APPROVED"]
        assert client.post(f"/api/v1/cases/{case}/reject",headers=APPROVER,json={"comment":"too late"}).status_code==409


def test_failed_processing_keeps_technical_error_out_of_the_review_reason(tmp_path, monkeypatch):
    with setup_client(tmp_path, monkeypatch) as client:
        case=register(client).json()["case_id"]
        work=client.post("/internal/v1/work-items/lease",json={"worker_id":"worker-1"}).json()["work_item"]
        client.post(f"/internal/v1/work-items/{work['id']}/complete",json={"worker_id":"worker-1","outcome":"FAILED","error":"ConnectError: refused","idempotency_key":"fail-work-item-v1"})
        saved=client.get(f"/api/v1/cases/{case}").json()
        assert saved["status"]=="PROCESSING_ERROR" and "ConnectError" not in saved["review_reason"]
        completed=[e for e in client.get(f"/api/v1/cases/{case}/history").json()["items"] if e["event_type"]=="WORK_ITEM_COMPLETED"][0]
        assert completed["reason"]=="Automatic processing failed." and completed["payload"]["error"]=="ConnectError: refused"


def test_return_needs_a_comment(tmp_path, monkeypatch):
    with setup_client(tmp_path, monkeypatch) as client:
        case=register(client).json()["case_id"]
        client.post(f"/internal/v1/cases/{case}/extraction-result",json={"fields":FIELDS,"idempotency_key":"extract-return-v1"})
        assert client.post(f"/api/v1/cases/{case}/return",headers=APPROVER,json={"comment":" "}).status_code==422
        r=client.post(f"/api/v1/cases/{case}/return",headers=APPROVER,json={"comment":"Wrong PO"})
        assert r.status_code==200 and r.json()["status"]=="RETURNED"
