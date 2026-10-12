# Tier 1 agent architecture

This POC implements the minimum useful agent flow while reusing the existing SAP service clients and triage pipeline.

## Execution order

1. **TOWER** (`src/agents/tower.py`): calls the existing SAP AI Core classifier. Its output is validated with a Pydantic contract. TOWER recommends a document category; it cannot change case state, approve, or post.
2. **LENS** (`src/agents/lens.py`): calls the existing SAP Document AI client only for `invoice` and `credit_note`. Other document types skip extraction and remain visible to the workflow.
3. **FINANCE_RULES** (`src/agents/rules.py`): calls the existing deterministic `run_triage` pipeline. This is not an LLM agent. Rules determine review findings; model confidence cannot override them.
4. **APAgentOrchestrator** (`src/agents/orchestrator.py`): coordinates the sequence and returns validated output plus an `agent_trace` containing each step's status, duration, and safe summary. The API persists this trace in the case validation JSON.
5. **Approval workflow** remains in `src/api/main.py` and `src/api/database.py`. Agents cannot approve or post invoices.

## Deferred intentionally

- **VECTOR**: defer PO match and G/L mapping until a trusted SAP vendor/PO adapter supplies real candidate data. A model must never invent a PO match or vendor identity.
- **PRISM**: defer multi-step discrepancy investigation until the basic classification, extraction, rules, and review path are reliable.
- **LangGraph / separate agent runtime**: not introduced in this tier. The current orchestrator provides explicit modular handoffs in one process. Add LangGraph only if persistent graph execution, branching, checkpointing, or independently deployed agents becomes necessary.
- **SAP posting**: not implemented by the agent flow.

## Configuration

`AGENT_MODE` supports three explicit modes:

- `disabled`: safe manual-review fallback; no agent is invoked.
- `mock`: offline architecture demo. TOWER uses a filename heuristic and LENS returns no fabricated field values. This mode proves the handoffs and trace only, not AI accuracy.
- `sap`: calls real SAP AI Core and SAP Document AI. Set `AGENT_MODE=sap` and `SAP_PROCESSING_ENABLED=true` only after service credentials and endpoints are configured.

The API loads `config/.env` at startup. The shipped `.env.example` selects live mode (`AGENT_MODE=sap`, `SAP_PROCESSING_ENABLED=true`). Live startup validates that both real service-key JSON files exist, parse correctly, and do not contain example placeholders. `mock` and `disabled` remain explicit development/test modes only.

## Inspecting agents

`GET /api/v1/agents` returns the execution order, active mode, purpose of each implemented component, and explicitly deferred agents.

For each case, `GET /api/v1/cases/{case_id}` includes `validation.agent_trace` after a processing run. The trace is operational metadata, not a source of approval authority.

## Tests

Run from the project root:

```bat
.venv\Scripts\python -m pytest -q
```

Agent tests use fake service clients and do not require live SAP credentials.
