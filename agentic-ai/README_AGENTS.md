# Agentic AI — agent implementation update

## Implemented agent components

- `EMAIL_INTAKE`: existing Microsoft Graph fetch/enrichment component (`src/email_intake`). Live Graph operation requires credentials.
- `CLASSIFIER`: classification adapter (`src/agents/classifier.py`). SAP AI Core is used in SAP mode; mock mode is heuristic-only.
- `SCANNER`: SAP Document AI extraction coordinator (`src/agents/scanner.py`).
- `VERIFIER`: PO matching recommendation (`src/agents/verifier.py`). Takes invoice fields plus a supplied SAP observation or an injected read-only SAP reader. Missing SAP evidence returns `UNKNOWN`.
- `RECONCILER`: evidence-grounded discrepancy investigation (`src/agents/reconciler.py`). Uses supplied rule results, observations and missing-field data; outputs follow-up recommendations only.
- `PLUMB`: payment advice reconciliation candidate matching (`src/agents/plumb.py`). Uses invoice reference, currency and `Decimal` amount comparisons. Does not mark invoices paid.
- `FINANCE_RULES`: deterministic triage component, not an AI agent.

## Extended orchestrator

The existing `APAgentOrchestrator` still runs the base upload flow CLASSIFIER -> SCANNER -> FINANCE_RULES by default. To invoke additional agents, pass `extended_context`:

```python
result = orchestrator.run(
    file_path,
    file_name,
    extended_context={
        "invoice_fields": {"po_number": "450001", "supplier_id": "V100", "company_code": "1000", "currency": "SAR", "total_amount": "100.00"},
        "sap_observation": {"supplier_id": "V100", "company_code": "1000", "currency": "SAR", "available_amount": "150.00", "fetched_at": "2026-10-16T10:00:00Z", "snapshot_hash": "source-generated-hash"},
        "rule_results": [{"rule_code": "PO_MATCH", "outcome": "UNKNOWN", "reason": "Example rule result"}],
        "sap_observations": [],
        "payment_advice": {"items": [{"invoice_number": "INV-100", "currency": "SAR", "paid_amount": "100.00"}]},
        "posted_invoices": [],
    },
)
```

Do not fabricate `sap_observation` in production. Populate it from a real read-only SAP adapter and preserve source, fetch timestamp and hash. These agents produce recommendations, not authorization decisions.

## Important boundaries / remaining integration

- VERIFIER has a read-only adapter protocol but no live S/4HANA PO/GR adapter is included.
- RECONCILER is evidence-grounded and deterministic in this implementation; it does not call a separate LLM provider.
- PLUMB requires payment-advice items and posted/open invoice records supplied by a trusted integration. It does not connect to a Treasury mailbox or SAP itself.
- AP Core integration is not automatically activated by this ZIP. Agentic AI still needs to send results to AP Core and AP Core must persist judgements and determine the next state.
- No agent approves invoices, sets canonical AP Core case state, or posts to SAP.

## Run

Use `./run_agentic_ai.sh` in Git Bash on Windows, or `run_agentic_ai.bat` in Command Prompt. The API registry is at `GET /api/v1/agents` and Swagger UI is at `http://127.0.0.1:8001/docs`.
