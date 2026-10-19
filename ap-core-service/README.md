# AP Automation · AP Core (first runnable service)

AP Core is the authority for invoice case state, deterministic routing, work scheduling, idempotency and audit. Agentic AI submits observations and recommendations; it cannot directly change the case state by submitting a model judgement. AP Core makes the routing decision from extracted fields and deterministic checks.

## Run locally

Python 3.11+ recommended.

```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
# Copy .env.example to .env and set AP_CORE_SERVICE_API_KEY before non-local deployment.
uvicorn ap_core.main:app --app-dir . --host 127.0.0.1 --port 8002 --reload
```

Health: `GET http://127.0.0.1:8002/health`
OpenAPI: `http://127.0.0.1:8002/docs`

For local development `APP_ENV=development` allows calls without the service key when it is unset. Set a real random `AP_CORE_SERVICE_API_KEY` and send `X-AP-Core-Key` for service-to-service calls. In non-development environments the key is mandatory. Do not expose internal endpoints directly to browsers or the public internet.

## Agentic AI connection

Install `httpx` in the Agentic AI environment and copy `integration/ap_core_client.py` into the runtime or add this folder to its Python path. Configure:

```dotenv
AP_CORE_URL=http://127.0.0.1:8002
AP_CORE_SERVICE_API_KEY=<same-secret-as-AP-Core>
```

If the Agentic AI runtime runs on port 8001 and AP Core on port 8002, use `AP_CORE_URL=http://127.0.0.1:8002`. If they run in different containers, `127.0.0.1` will point to the container itself; use the AP Core service DNS name instead.

Example:

```python
from integration.ap_core_client import APCoreClient

ap = APCoreClient()
# Intake service must store the file in DMS/object storage first and provide its stable reference.
registered = ap.register_upload(
    file_name="invoice.pdf",
    sha256="<64-character-sha256-of-file-bytes>",
    document_ref="dms://documents/<object-id>",
)
if not registered["duplicate"]:
    # Agentic AI should process the leased work item and send results back.
    leased = ap.lease_work(worker_id="agentic-ai-1")
    work = leased["work_item"]
    if work:
        # Use work['case_id'] and resolve work's document_ref from DMS.
        result = ap.submit_extraction(
            work["case_id"],
            fields={"invoice_number":"INV-123", "supplier_name":"Example Supplier", "company_code":"1000", "currency":"SAR", "total_amount":"12500.00"},
            idempotency_key=f"lens-extraction:{work['case_id']}:v1",
        )
        ap.complete_work(work["id"], worker_id="agentic-ai-1", outcome="SUCCEEDED", idempotency_key=f"complete:{work['id']}", result=result)
ap.close()
```

The example field values are illustrative only. Do not hardcode them in production.

## Key API contract

- `POST /internal/v1/cases/register-upload`: registers a document by SHA-256; exact duplicate returns the canonical case and does not create another work item.
- `POST /internal/v1/work-items/lease`: leases a task for a worker; expired leases can be reclaimed.
- `POST /internal/v1/cases/{id}/agent-judgements`: stores `MODEL_JUDGEMENT` only; does not change state.
- `POST /internal/v1/cases/{id}/extraction-result`: stores extracted observations, runs deterministic required-field and business-duplicate checks, then routes to `NEEDS_REVIEW` or `READY_FOR_APPROVAL`.
- `POST /internal/v1/work-items/{id}/complete`: records success/retry/failure; retry uses bounded exponential delay and max attempts.
- `POST /internal/v1/cases/{id}/transition`: enforces state transitions, optimistic version checks, and approval/posting preconditions.
- `GET /internal/v1/cases/{id}/audit`, `/judgements`, `/rule-results`: evidence and audit read models.

Human workflow, called by the AP Console gateway after Keycloak sign-in. The gateway sends the service key plus `X-User-Id` / `X-User-Role` from the verified token; AP Core never accepts these headers without the key:

- `POST /api/v1/cases/upload`: PDF upload by an AP_PROCESSOR or ADMIN, recorded as `created_by`.
- `GET /api/v1/cases/{id}/document`, `/history`: the stored PDF and the audit trail.
- `PATCH /api/v1/cases/{id}/fields`: a reviewer corrects fields in NEEDS_REVIEW, RETURNED or PROCESSING_ERROR; the deterministic checks run again and route the case.
- `POST /api/v1/cases/{id}/approve | return | reject`: an AP_APPROVER or FINANCE_MANAGER decides, within `ALLOWED_TRANSITIONS`; the approver cannot be the person who uploaded or corrected the invoice.

## Current scope / honest limitations

This is a runnable AP Core foundation and a service integration contract, not the entire production AP platform. It does not yet implement Graph mail intake, DMS storage, malware scanning, SAP read adapters, BPA integration, a real SAP posting adapter, full RBAC/SSO, HANA persistence, or outbox-based event delivery. The initial persistence is SQLite. The `POSTING` transition requires a permit and frozen package hash, but this service intentionally does not post to S/4HANA. Before production, add enterprise identity, secret management, network policy, HANA migrations, document security scanning, and integration tests against the actual Agentic AI runtime.
