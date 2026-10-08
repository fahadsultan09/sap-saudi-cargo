# AP Agentic Automation, prototype

Stack follows the architecture diagram: Python 3.12 + FastAPI + Pydantic v2 (AP Core, workers), React + TypeScript console,
Node.js AppRouter, XSUAA roles, Cloud Foundry (mta.yaml). SQLite stands in for SAP HANA Cloud. SAP, AI Core and Document AI are mocked.

## Run
    cd backend && pip install -r requirements.txt && pytest -q && uvicorn app.main:app --reload
    cd console && npm install && npm run dev        # http://localhost:5173

## Map to the diagram
- app/core.py    L1 case control. One transaction per transition, each writes a journal event.
- app/rules.py   deterministic rules engine (6 of ~191 checks).
- app/agents.py  L3 reasoning. Advice only, replace with SAP AI Core call.
- app/posting.py ap-posting-command, the single SAP writer: approval check, package hash, idempotency key.
- app/sap.py     SAP adapter, read and write paths kept apart.
- Roles: processor confirms, approver approves, and the approver cannot be the person who confirmed.

## Document AI (ap-worker-document)
`app/document.py` calls SAP Document AI: OAuth client credentials from the service key, `POST /document/jobs`, poll `GET /document/jobs/{id}`, read `headerFields` with confidence.
Fields under 0.80 confidence (or missing) put the case in NEEDS_REVIEW. A processor corrects them at `POST /api/v1/cases/{id}/review`, logged as a human decision. Rules only run after that.

    export DOC_AI_MODE=sap
    export DOC_AI_SERVICE_KEY='{...paste the service key JSON...}'
    # optional: DOC_AI_SCHEMA, DOC_AI_CLIENT, DOC_AI_BASE_PATH, DOC_AI_FIELD_MAP, DOC_AI_MIN_CONF

Default is `DOC_AI_MODE=stub`, which reads a plain text file like this (add ? after a value for low confidence):

    Vendor: Gulf Aviation Fuel Co
    Invoice No: INV-7781
    Net: 10000.00
    VAT: 1500.00
    PO: 4500012345

The SAP client is tested only against a mocked HTTP service. Check endpoint paths and field names against your own service key and schema in the Swagger UI before relying on it.

## Agent (investigates only when rules cannot settle a case)
Clean and duplicate cases use plain rules, no model call. For FAIL or UNKNOWN results, `app/agent_runner.py` runs a bounded loop (max 6 steps, 60 s):
the model picks read-only tools from `app/tools.py` (get_po, get_goods_receipts, vendor_history, find_similar_cases), returns a JSON finding checked by a Pydantic schema,
and a guard rejects a POST amount outside [PO value, invoice total]. Any failure falls back to the rule-based recommendation. Every tool call is a MODEL_JUDGEMENT event. There is no write tool.

    AGENT_MODE=stub     scripted agent, no model needed (default)
    AGENT_MODE=aicore   AICORE_SERVICE_KEY='{...}' AICORE_DEPLOYMENT_URL='<deployment url>' AICORE_RESOURCE_GROUP=default
    AGENT_MODE=off      rules only

The AI Core client calls `{deployment_url}/chat/completions` with a bearer token and `AI-Resource-Group` header (OpenAI-style deployment). It is tested only against a mocked server.
Orchestration-mode deployments use a different path and body, so adapt `llm.py` if yours is one.

## Demo
Samples are in `samples/` (PDFs for Document AI, .txt for stub mode): clean, 900 SAR over PO (agent finds the approved surcharge), and goods receipt missing (agent holds).
Reset between runs by deleting `backend/ap.db`. Demo order: log in as aisha, upload, run checks, confirm. Switch to omar, approve, post, press Post again, open Audit trail.

## Not done
HANA, real DMS (documents sit in a SQLite table), Event Mesh, BPA workflows, AI Core, real XSUAA JWT validation (headers are a dev stub), console not build-tested, mta.yaml not deployed.
