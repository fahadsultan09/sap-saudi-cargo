"""Small service client for Agentic AI / worker processes to call AP Core."""
from __future__ import annotations
import os
import httpx
from typing import Any

class APCoreClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None, timeout: float = 20.0):
        self.base_url = (base_url or os.getenv("AP_CORE_URL", "http://127.0.0.1:8002")).rstrip("/")
        self.api_key = api_key if api_key is not None else os.getenv("AP_CORE_SERVICE_API_KEY", "")
        self.client = httpx.Client(base_url=self.base_url, timeout=timeout, headers={"X-AP-Core-Key": self.api_key} if self.api_key else {})

    def health(self) -> dict[str, Any]:
        r=self.client.get("/health"); r.raise_for_status(); return r.json()

    def register_upload(self, *, file_name: str, sha256: str, document_ref: str, source: str = "agentic-ai", created_by: str = "agentic-ai", correlation_id: str | None = None) -> dict[str, Any]:
        r=self.client.post("/internal/v1/cases/register-upload", json={"file_name":file_name,"sha256":sha256,"document_ref":document_ref,"source":source,"created_by":created_by,"correlation_id":correlation_id})
        r.raise_for_status(); return r.json()

    def lease_work(self, *, worker_id: str, task_types: list[str] | None = None, lease_seconds: int = 120) -> dict[str, Any]:
        r=self.client.post("/internal/v1/work-items/lease", json={"worker_id":worker_id,"task_types":task_types or ["PROCESS_DOCUMENT"],"lease_seconds":lease_seconds})
        r.raise_for_status(); return r.json()

    def submit_judgement(self, case_id: str, *, agent_name: str, judgement_type: str, payload: dict[str, Any], idempotency_key: str, model_version: str | None = None, correlation_id: str | None = None) -> dict[str, Any]:
        r=self.client.post(f"/internal/v1/cases/{case_id}/agent-judgements", json={"agent_name":agent_name,"judgement_type":judgement_type,"payload":payload,"idempotency_key":idempotency_key,"model_version":model_version,"correlation_id":correlation_id})
        r.raise_for_status(); return r.json()

    def submit_extraction(self, case_id: str, *, fields: dict[str, Any], idempotency_key: str, validation: dict[str, Any] | None = None, correlation_id: str | None = None) -> dict[str, Any]:
        r=self.client.post(f"/internal/v1/cases/{case_id}/extraction-result", json={"fields":fields,"validation":validation or {},"idempotency_key":idempotency_key,"correlation_id":correlation_id})
        r.raise_for_status(); return r.json()

    def complete_work(self, work_item_id: str, *, worker_id: str, outcome: str, idempotency_key: str, result: dict[str, Any] | None = None, error: str | None = None) -> dict[str, Any]:
        r=self.client.post(f"/internal/v1/work-items/{work_item_id}/complete", json={"worker_id":worker_id,"outcome":outcome,"idempotency_key":idempotency_key,"result":result or {},"error":error})
        r.raise_for_status(); return r.json()

    def close(self) -> None:
        self.client.close()
