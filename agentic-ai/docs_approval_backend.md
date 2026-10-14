# SACC AP approval backend

This backend extends the existing triage project. It does not replace `src/triage`, `src/email_intake`, or the existing workflow CLI. The UI5 application remains separate and calls this API.

## Local run

1. Create/activate the existing `.venv` and install requirements: `python -m pip install -r requirements.txt`.
2. Run `run_api.bat` on Windows, or from the project root:

   ```bash
   APP_ENV=development AUTH_MODE=dev AP_DATA_DIR=./runtime_data uvicorn api.main:app --app-dir src --reload
   ```

3. Open `http://127.0.0.1:8001/docs`.
4. In development only, send `X-User-Id` and `X-User-Role` headers. Allowed roles are `AP_PROCESSOR`, `AP_APPROVER`, `FINANCE_MANAGER`, and `ADMIN`. Example: `X-User-Id: processor-01`, `X-User-Role: AP_PROCESSOR`.

Development-header authentication is intentionally blocked unless `APP_ENV=development`. It is not production authentication. For deployment set `APP_ENV=production`, `AUTH_MODE=jwt`, configure a trusted `AUTH_JWT_SECRET` of at least 32 characters, and configure issuer/audience as appropriate. In a real SAP BTP deployment, prefer validating tokens issued by the approved identity provider and mapping role collections to the application's roles.

## Existing and new workflow

- `src/triage/ai_core.py` remains the SAP AI Core classification adapter.
- `src/triage/doc_ai.py` remains the SAP Document AI extraction adapter.
- `src/triage/pipeline.py` remains deterministic triage and extraction validation.
- `src/api/main.py` exposes upload, case details, field corrections, submission, approval decisions, document preview and history.
- `src/api/database.py` persists cases, approval requests, decisions, audit events and posting placeholders in SQLite for the POC.
- `src/api/workflow.py` calls the existing AI Core, Document AI and triage modules when `SAP_PROCESSING_ENABLED=true`.

By default `SAP_PROCESSING_ENABLED=false`; uploads remain visible in `NEEDS_REVIEW` instead of pretending SAP extraction succeeded. Set it to `true` only after the credential files and SAP endpoints have been configured. External processing failures are surfaced as `PROCESSING_ERROR`.

## Main endpoints

- `GET /health`
- `GET /api/v1/me`
- `POST /api/v1/cases/upload` (multipart form field `file`)
- `GET /api/v1/cases`
- `GET /api/v1/cases/{case_id}`
- `GET /api/v1/cases/{case_id}/document`
- `PATCH /api/v1/cases/{case_id}/fields`
- `POST /api/v1/cases/{case_id}/submit-for-approval`
- `GET /api/v1/approvals`
- `POST /api/v1/cases/{case_id}/approve`
- `POST /api/v1/cases/{case_id}/return`
- `POST /api/v1/cases/{case_id}/reject`
- `GET /api/v1/cases/{case_id}/history`

## Workflow rules

1. Only AP processors or admins can upload and correct review cases.
2. A case must have invoice number, supplier name, currency and total amount before submission.
3. The processor must explicitly confirm vendor, tax and duplicate checks. A PO-backed invoice also requires a PO check. For a non-PO invoice, the submission comment must explain the non-PO path.
4. AP approvers cannot approve invoices they created or last edited. AP approvers are limited by `AP_APPROVER_MAX_AMOUNT`; finance managers can approve above that limit.
5. Admin is deliberately not automatically an approver.
6. Every correction, submission, decision and status transition creates an audit event.
7. Approval only creates a `NOT_CONFIGURED` posting placeholder. It does not post to SAP. A real posting adapter, approval policy matrix and SAP reconciliation must be implemented and tested before production use.

## UI5 integration notes

- Use `FormData` for the upload endpoint.
- Send the access token in `Authorization: Bearer ...` in production.
- For local development only, send `X-User-Id` and `X-User-Role` headers.
- Poll `GET /api/v1/cases/{case_id}` after upload.
- Load the queue from `GET /api/v1/approvals`.
- Show validation findings and the original document from `GET /api/v1/cases/{case_id}/document`.
- Send corrections as `{ "fields": { "invoice_number": "INV-1001" }, "comment": "Verified against original PDF" }`.
- Submit for approval as `{ "comment": "Vendor, tax and duplicate checks completed; non-PO path confirmed", "confirmed_checks": ["vendor", "tax", "duplicate"] }` for a non-PO invoice. Add `po` to `confirmed_checks` for a PO-backed invoice.
- Approve/return/reject with `{ "comment": "Decision rationale" }`.

## POC limitations

- SQLite is suitable for a single-process local POC, not concurrent production deployment. Use PostgreSQL or an approved SAP database service for multi-worker deployment.
- Development headers are not secure identity. Do not expose them outside localhost.
- Approval thresholds are placeholders and must be replaced with the company's authorized approval matrix.
- Vendor, PO, tax and duplicate checks are human-attested in this POC; they are not live SAP master-data checks.
- The posting adapter is not implemented. Approval is not equivalent to a posted SAP document.
- Store documents in approved object storage and enforce retention, malware scanning and access policy before production.
