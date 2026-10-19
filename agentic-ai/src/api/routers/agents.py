from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..auth import get_actor
from ..config import AGENT_MODE
from ..schemas import Actor

router = APIRouter(prefix="/api/v1")


def _agent_status() -> str:
    if AGENT_MODE == "mock":
        return "running_mock"
    return "enabled" if AGENT_MODE == "sap" else "disabled"


def _tower_service() -> str:
    if AGENT_MODE == "sap":
        return "SAP AI Core"
    return "offline filename heuristic" if AGENT_MODE == "mock" else "not invoked"


def _lens_service() -> str:
    if AGENT_MODE == "sap":
        return "SAP Document AI"
    return "offline empty-result adapter" if AGENT_MODE == "mock" else "not invoked"


@router.get("/agents")
def list_agents(actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    """List implemented agent components and their integration requirements."""
    common_status = _agent_status()
    return {
        "mode": AGENT_MODE,
        "orchestrator": "APAgentOrchestrator",
        "execution_order": ["EMAIL_INTAKE", "TOWER", "LENS", "FINANCE_RULES", "VECTOR", "SOURCE_CHECK", "PRISM", "PLUMB"],
        "agents": [
            {"name": "EMAIL_INTAKE", "kind": "source acquisition worker/agent", "status": "implemented",
             "purpose": "Fetch and enrich Microsoft Graph messages and attachments; does not classify them.",
             "integration": "Requires configured Microsoft Graph credentials for live mode."},
            {"name": "TOWER", "kind": "classification agent adapter", "status": common_status,
             "purpose": "Recommend document type and processing path", "service": _tower_service()},
            {"name": "LENS", "kind": "extraction agent adapter", "status": common_status,
             "purpose": "Coordinate SAP Document AI extraction for invoices and credit notes", "service": _lens_service()},
            {"name": "VECTOR", "kind": "read-only matching recommendation agent", "status": "implemented_requires_sap_context",
             "purpose": "Compare invoice facts to supplied/read-only SAP PO context; missing evidence returns UNKNOWN.",
             "side_effects": "none; does not write SAP or approve invoices"},
            {"name": "SOURCE_CHECK", "kind": "deterministic SAP reference-data check", "status": "implemented_uses_sap_excel_exports",
             "purpose": "Compare the extracted invoice with the SAP PO, supplier, receipt, account and bank data and write a verdict.",
             "side_effects": "none; read-only, does not approve invoices"},
            {"name": "PRISM", "kind": "evidence-grounded investigation agent", "status": "implemented_requires_evidence",
             "purpose": "Group failed/unknown rule results and produce follow-up investigation recommendations.",
             "side_effects": "none; does not invent SAP facts or execute actions"},
            {"name": "PLUMB", "kind": "payment reconciliation recommendation agent", "status": "implemented_requires_payment_data",
             "purpose": "Match payment advice items to supplied posted-invoice records using reference, currency and Decimal amount.",
             "side_effects": "none; does not mark invoices paid or write SAP"},
            {"name": "FINANCE_RULES", "kind": "deterministic component, not an LLM agent", "status": "enabled",
             "purpose": "Run deterministic triage checks; financial eligibility remains a rule/AP Core responsibility."},
        ],
        "invariants": [
            "Agents do not approve invoices", "Agents do not set authoritative case status",
            "Agents do not post to SAP", "Missing SAP evidence is UNKNOWN, not PASS",
            "VECTOR and PLUMB outputs are recommendations and require AP Core processing",
        ],
    }
