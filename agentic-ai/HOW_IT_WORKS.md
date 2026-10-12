# How the SACC AP Triage solution works

This project is the front end of an accounts-payable (AP) automation for Saudia Cargo (SACC). It reads supplier emails from a mailbox, works out what each attachment is, extracts the invoice data, applies a few validation rules and writes everything to files you can inspect. It does **not** post anything to SAP yet.

## 1. The flow at a glance

```
 Mailbox (Microsoft Graph)
        |  run.bat                      latest N emails + their attachments
        v
 1. Email intake        src/email_intake/
        |  one copy of every attachment is saved to output/attachments/
        v
 2. Classification      SAP AI Core (LLM, vision)          src/triage/ai_core.py
        |  "invoice", "credit_note", "statement_of_account", ...
        |  reply validated by Pydantic (src/triage/models.py)
        |
        +-- not an invoice / credit note ---> result says "not extracted", stop
        v
 3. Extraction          SAP Document AI (DOX)              src/triage/doc_ai.py
        |  header fields + line items, each with a confidence
        v
 4. Triage rules        src/triage/pipeline.py, runner.py
        |  invoice type, field cleanup, validation, review flag
        v
 5. Output files        src/workflow/run_log.py
        run_log.csv, dox_fields.csv, dox_raw/, results/, run.log
```

The orchestration (looping over emails and attachments, writing the logs) is in `src/workflow/orchestrator.py`.

## 2. Running it

### One-time setup
1. Install Python 3.11 or newer.
2. Double-click or run `setup.bat`. It creates `.venv`, installs `requirements.txt` and creates the config files from the `.example` templates if they are missing.
3. Fill in the three config files (they are git-ignored; never commit them):

| File | What goes in it |
|---|---|
| `config/.env` | Microsoft Graph settings (`GRAPH_USER_ID`, `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`) and the two confidence thresholds |
| `config/ai_core_cred.json` | The SAP AI Core service key |
| `config/sap_credentials.json` | The SAP Document AI service key |

Graph authentication uses the client credentials (tenant, client ID, secret) when all three are set. `GRAPH_API_TOKEN` is only used as a fallback when they are not.

### Everyday commands

| Command | What it does |
|---|---|
| `run.bat` | Process the **latest email** |
| `run.bat --top 5` | Process the latest 5 emails |
| `run.bat --download-only --top 50` | Only download attachments (no AI Core, no Document AI) |
| `run.bat --dry-run` | Fetch emails, skip triage |
| `run.bat --doc-ai` | Triage every PDF in `invoice_samples\` (no email needed) |
| `python run_email_intake.py --top 3` | Test only the mailbox connection |
| `run_tests.bat` | Unit tests (no network needed) |

Typical use: send yourself an email with an invoice, run `run.bat`, open `output\run_log.csv`.

Things to know:
- It is **one-shot**. There is no polling or scheduler, and it does not remember which emails it has already processed. Running it twice on the same email processes it twice and adds duplicate rows.
- The newest email is chosen by received time across the whole mailbox, not just the Inbox folder.
- Close `output\run_log.csv` (and the other CSVs) before running. If Excel has a file open, Windows blocks writing to it, so the run writes to a new file such as `run_log_20261005_005500.csv` instead.

## 3. Step by step

### Step 1: Email intake (`src/email_intake/`)
- Gets a Microsoft Graph token, then fetches the latest `--top` messages ordered by received time, then fetches each message's body and attachments.
- Each email becomes an `EmailMessage` (id, subject, sender, received date, body, attachments).

### Step 2: Save the attachments (`save_attachment_copy` in the orchestrator)
- Every non-inline attachment is saved to `output/attachments/<date>_<subject>_<id>/<file name>`. This is the copy you can review by hand and the one that will later be uploaded to the SAP Document Management Service.

### Step 3: Classification with SAP AI Core (`src/triage/ai_core.py`)
- Only `.pdf`, `.png`, `.jpg`, `.jpeg` attachments that are not inline are classified. Others get a "skipped" row in the CSV.
- A PDF is converted to one image per page (PyMuPDF). Each page is sent to the AI Core chat deployment together with the email subject, sender and file name.
- The system prompt explains the finance context and defines the categories. The email text is wrapped in `<untrusted_content>` tags and the model is told never to follow instructions inside it.
- The model must answer with JSON: `document_type`, `confidence`, `reason`.
- `document_type` is limited to: `invoice`, `credit_note`, `supporting_document`, `reconciliation`, `statement_of_account`, `purchase_order_list`, `general_correspondence`.
- **Pydantic validation** (`src/triage/models.py`): the reply is parsed and checked. Variants like "Credit Note" are normalised; anything outside the list is rejected. A bad reply gets **one repair retry**; if it is still invalid the document is marked `ai_parse_status=failed` and sent to review.
- For multi-page PDFs the pages vote (weighted by confidence), so a cover page does not decide the whole document.

### Step 4: Extraction with SAP Document AI (`src/triage/doc_ai.py`)
- Runs **only** if AI Core said `invoice` or `credit_note`. Everything else skips this step.
- The file is uploaded with the options `documentType: invoice` and the invoice schema (`SAP_invoice_schema`). Document AI does **not** decide the document type; it extracts invoice fields from whatever it is given. That is why AI Core classifies first.
- The code polls the job every 5 seconds until it is `DONE`.
- Result: header fields (invoice number, date, supplier, amounts, currency, PO number, addresses, bank details and so on) and line items. Every field has a confidence between 0 and 1.
- The complete raw response is saved to `output/dox_raw/`, and a flat table of every field and its confidence to `output/dox_fields.csv`.

### Step 5: Triage rules (`src/triage/runner.py` and `pipeline.py`)
This is everything that happens to the extracted data:

1. **Document type gate.** Only `invoice` and `credit_note` continue. Other types return a result marked for review with the reason "not an invoice or credit note; not sent to invoice extraction". If AI Core failed validation, the type is unknown and the document goes to review.
2. **Invoice type.** Keyword matching (whole words) over the supplier name, line-item descriptions and similar text. Address, bank, phone and email fields are ignored. Result: `FUEL`, `CARGO`, `CHARTER`, `SERVICE` or `OTHER`. The first match in that order wins.
3. **Field cleanup.** Document AI's camelCase names are mapped to the pipeline's names (`DOX_FIELD_ALIASES`): `documentNumber` to `invoice_number`, `documentDate` to `invoice_date`, `senderName` to `supplier_name`, `grossAmount` to `total_amount`, `currencyCode` to `currency`, `purchaseOrderNumber` to `po_number`, and so on. If there are no line items but there is a total, one placeholder line item is created. Empty line-item rows are dropped.
4. **Validation.** The document is flagged for review if any of these is true:
   - a required field is missing: `invoice_number`, `invoice_date`, `supplier_name`, `total_amount`, `currency` (list: `REQUIRED_HEADER_FIELDS` in `pipeline.py`);
   - a required field's confidence is below `MIN_REQUIRED_FIELD_CONFIDENCE` (default 0.80);
   - the overall confidence is below `MIN_CONFIDENCE_THRESHOLD` (default 0.75). Overall confidence is the average over the required fields that were found;
   - there are no line items.
5. **Result.** One result per attachment: document type, invoice type, extracted header fields, line items, confidence, an evidence trail (one line per step), `review_required`, `review_reason` and the list of missing fields. The result model is a Pydantic class (`TriageResult` in `src/triage/types.py`).

### Step 6: Output (`src/workflow/run_log.py`)
Written for every attachment, including skipped and failed ones.

## 4. Output files (all under `output/`)

| File | Contents |
|---|---|
| `run_log.csv` | **The main table.** One row per attachment, appended across runs, opens in Excel |
| `dox_fields.csv` | One row per Document AI field: value and confidence (header fields and line items) |
| `dox_raw/*.json` | The raw Document AI response for each extraction |
| `results/*.json` | The full triage result per attachment, including the evidence trail |
| `attachments/` | Copies of the attachments, one folder per email |
| `run.log` | Detailed text log of every run |

`run_log.csv` columns: run_id, timestamp, email_id, subject, sender, received, attachment_name, attachment_size, saved_path, status (processed, skipped or error), ai_document_type, ai_confidence, ai_reason, ai_parse_status, dox_job_id, dox_status, dox_raw_path, invoice_number, invoice_date, supplier_name, po_number, total_amount, currency, triage_document_type, invoice_type, triage_confidence, review_required, review_reason, missing_fields, error, duration_s.

If the CSV layout changes between versions, the old file is renamed to `run_log_old_<timestamp>.csv` instead of being mixed with the new columns.

## 5. What is NOT done (yet)

The solution stops after "extract and flag". Specifically, none of these happen:
- posting to SAP or any ERP;
- vendor lookup or matching against a vendor master;
- PO matching or PO validation;
- duplicate-invoice detection;
- tax, compliance, amount or currency rule checks;
- uploading the attachment to the SAP Document Management Service (planned);
- sending flagged documents to a review queue (`review_required` is only a flag in the files);
- a company or legal-entity check (removed on request);
- polling the mailbox or remembering processed emails;
- a cross-check between AI Core's classification and what Document AI found (for example "classified as invoice but no invoice number extracted").

## 6. Code map

```
run.bat / setup.bat / run_tests.bat     Windows launchers
run_workflow.py                         email -> triage (used by run.bat)
run_triage.py                           single files / batch of samples / JSON payloads
run_email_intake.py                     mailbox connection test
config/                                 .env, credentials, *.example templates, document_types.json
src/email_intake/                       Graph authentication, fetching, attachment helpers
src/triage/ai_core.py                   AI Core client, prompt, retry, page voting
src/triage/models.py                    Pydantic model that constrains the LLM reply
src/triage/doc_ai.py                    Document AI client and result conversion
src/triage/pipeline.py                  the triage rules (type, field cleanup, validation)
src/triage/runner.py                    runs the triage steps in order
src/triage/types.py                     DocumentType, InvoiceType, TriageResult
src/triage/config.py                    settings (thresholds, paths); loads config/.env
src/workflow/orchestrator.py            loops emails and attachments, calls everything
src/workflow/run_log.py                 logging and all CSV / JSON output
tests/                                  unit tests (run_tests.bat)
```

## 7. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `401 Unauthorized` from Graph | A placeholder `GRAPH_API_TOKEN` was used. The code now prefers the client credentials; make sure tenant, client ID and secret are set |
| `AADSTS700016 ... application not found` | The `GRAPH_CLIENT_ID` does not belong to the tenant in `GRAPH_TENANT_ID`; copy the Application (client) ID from the Azure app registration |
| `No emails fetched` | Authentication failed or the mailbox is empty; see the log message above it |
| New rows are in `run_log_<time>.csv`, not `run_log.csv` | The CSV was open in Excel or your editor; close it and rename or merge the side file |
| `ai_parse_status=failed` | The model answered twice with something that did not match the allowed categories; the document is sent to review. See `run.log` for the reply |
| Every invoice flagged for review | Document AI's confidence on key fields is often 0.75 to 0.85; the cut-off is `MIN_REQUIRED_FIELD_CONFIDENCE` in `config/.env` |
