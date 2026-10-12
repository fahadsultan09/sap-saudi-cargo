# SACC AP Invoice Triage (POC)

Email (Microsoft Graph) -> **SAP AI Core** classifies each attachment -> **SAP Document AI (DOX)** extracts invoice data (invoices and credit notes only) -> **triage rules** decide company, invoice type and whether a person must review it.

Full explanation of the flow, rules and outputs: **[HOW_IT_WORKS.md](HOW_IT_WORKS.md)**.

## Run it (Windows)

1. `setup.bat` creates `.venv`, installs dependencies and creates the config files from the templates.
2. Fill in the three git-ignored config files (never commit them):
   - `config/.env` company settings and Microsoft Graph settings
   - `config/ai_core_cred.json` SAP AI Core service key
   - `config/sap_credentials.json` SAP Document AI service key
3. `run.bat` processes the latest email. Options: `run.bat --top 5`, `run.bat --dry-run`.
   - `run.bat --doc-ai` triages every PDF in `invoice_samples\` (no email needed).
4. `run_tests.bat` runs the unit tests (no network).

To share the project, zip the folder without `.venv\`, `output\` and the three config files above (or push to git; `.gitignore` already excludes them).

## Output

| File | What |
|---|---|
| `output/run_log.csv` | **The table.** One row per attachment: email, AI type/confidence/reason, DOX fields (invoice number, PO, amount...), triage result, review flag and reason, errors. Open in Excel. Rows are appended across runs. |
| `output/dox_fields.csv` | One row per Document AI field with its **confidence** (header fields and line items) |
| `output/dox_raw/*.json` | The raw Document AI response for every extraction (values, confidences, coordinates) |
| `output/attachments/` | A copy of every attachment, one folder per email (for manual review / later DMS upload) |
| `output/results/*.json` | Full triage result per attachment |
| `output/run.log` | Detailed text log |

If Excel has a CSV open, new rows go to a side file such as `output/run_log_<time>.csv` instead.
`run.bat --download-only --top 50` only downloads the attachments (no AI Core, no Document AI).

## Where the review rules live

- Required invoice fields: `REQUIRED_HEADER_FIELDS` in `src/triage/pipeline.py`
- Confidence thresholds: `MIN_REQUIRED_FIELD_CONFIDENCE` (per required field) and `MIN_CONFIDENCE_THRESHOLD` (overall), set in `config/.env`
- Document AI field-name mapping: `DOX_FIELD_ALIASES` in `src/triage/pipeline.py`

## How the LLM is constrained

`src/triage/models.py` defines `AICoreClassification`: `document_type` must be one of
`invoice, credit_note, supporting_document, reconciliation, statement_of_account, purchase_order_list, general_correspondence`, with an optional `reason` (and optional `confidence`). Every model reply is validated; an invalid reply gets one repair retry, and a second failure is recorded as `ai_parse_status=failed` and sent to review. Only `invoice` and `credit_note` go on to Document AI.

## Layout

```
run.bat / setup.bat / run_tests.bat
run_workflow.py     email -> triage       run_triage.py   file / batch triage
run_email_intake.py fetch email only
src/email_intake/   Graph fetch + attachments
src/triage/         ai_core.py (LLM), models.py (Pydantic), doc_ai.py (DOX), pipeline.py + runner.py (rules)
src/workflow/       orchestrator.py, run_log.py (CSV + logging)
config/             *.example templates, document_types.json
```

## Finance approval API (new)

The existing CLI workflow remains available. A FastAPI backend has been added for the UI5 screen, with persistent invoice cases, manual review, a finance approval queue, role checks and audit history.

### Start the API on Windows

1. Run `setup.bat` if dependencies are not installed.
2. Run `run_api.bat`.
3. Open `http://127.0.0.1:8001/docs` to explore the endpoints.

The API uses a local SQLite database and stores uploads under `runtime_data/` by default. The provided `config/.env.example` is configured for **live SAP processing** (`AGENT_MODE=sap`, `SAP_PROCESSING_ENABLED=true`). The API refuses to start in live mode if the SAP AI Core or SAP Document AI service key is missing, malformed, or still contains example placeholders.

Read [docs_approval_backend.md](docs_approval_backend.md) for endpoints, role behavior, UI5 request examples and limitations.

**Local development authentication only:** send `X-User-Id` and `X-User-Role` headers, for example `X-User-Id: processor-01` and `X-User-Role: AP_PROCESSOR`. This is accepted only with `APP_ENV=development`. Do not expose the development server to a network. Production must use verified bearer tokens and an approved identity provider.

**Posting is not implemented:** approval records the decision and creates a `NOT_CONFIGURED` posting placeholder. It does not write to SAP.

## Minimal agent architecture (Tier 1)

The API now coordinates the existing SAP clients through a small explicit agent layer:

`TOWER (SAP AI Core classification) -> LENS (SAP Document AI extraction, invoices/credit notes only) -> FINANCE_RULES (existing deterministic triage) -> human review / approval workflow`.

The agents recommend and extract. They do not set case status, approve invoices, or post to SAP. `VECTOR` (PO/G/L matching) is deferred until a trusted SAP PO/vendor-data adapter exists. `PRISM` is deferred because multi-step discrepancy investigation is not required to prove the first end-to-end path.

### Agent modes

The project is intended to run with real SAP services for this implementation phase. `config/.env.example` selects:

```env
AGENT_MODE=sap
SAP_PROCESSING_ENABLED=true
```

Before starting the API, replace the example values in these local, git-ignored files with real service keys from your SAP BTP subaccount:

- `config/ai_core_cred.json` — SAP AI Core service key, including `url`, `clientid`, `clientsecret`, and `serviceurls.AI_API_URL`.
- `config/sap_credentials.json` — SAP Document AI service key, including `uaa.url`, `uaa.clientid`, `uaa.clientsecret`, and the top-level `url`.

Run `setup.bat` to install dependencies and create local config files, then edit both JSON files and `config/.env` before running `run_api.bat`. Startup validation rejects missing or placeholder credentials. Never paste service secrets into chat or commit them.

The `mock` and `disabled` modes remain available only for isolated development/tests; they are not the recommended runtime profile. In live mode, an SAP service failure is recorded as `PROCESSING_ERROR` rather than replaced with mock output. Even with live extraction, cases remain in human review until the trusted vendor/PO/tax/duplicate checks are integrated. SAP posting is not implemented by this POC.

Use `GET /api/v1/agents` to see which components are active and which agents are deferred. See `AGENTS_ARCHITECTURE.md` for boundaries and tests.


## Verify live SAP connectivity

1. Copy `config/.env.example` to `config/.env` if you have not already done so.
2. Put your SAP AI Core service key in `config/ai_core_cred.json` and your SAP Document AI service key in `config/sap_credentials.json`. Keep both files private and uncommitted.
3. Set `SAP_DOX_SCHEMA_ID` in `config/.env` to the ID of your confirmed invoice schema.
4. Activate the project virtual environment and run `python scripts/check_sap_connections.py`. This checks OAuth, a RUNNING AI Core foundation-model deployment, and the Document AI schema configuration without uploading a document or printing credentials.
5. If the check passes, run `run_api.bat`, open `http://127.0.0.1:8001/docs`, upload a real invoice PDF to `POST /api/v1/cases/upload`, and inspect the returned case with `GET /api/v1/cases/{case_id}`.

The first end-to-end upload is the definitive test of model compatibility, extraction schema mapping, and result conversion. A successful connection check alone does not prove that invoice extraction works. The current workflow does not post invoices to SAP.
