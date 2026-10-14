from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .contracts import AgentTrace, AgentWorkflowResult
from .lens import LensExtractionAgent
from .rules import DeterministicTriageRules
from .tower import TowerTriageAgent

logger = logging.getLogger("sacc_agents")


class APAgentOrchestrator:
    """Coordinates the minimum Tier 1 AP agent flow: TOWER -> LENS -> rules.

    It does not approve invoices, mutate case state, perform SAP matching, or
    post financial transactions. Those remain backend workflow responsibilities.
    """
    def __init__(self, *, tower: Any | None = None, lens: Any | None = None, rules: Any | None = None):
        self.tower = tower or TowerTriageAgent()
        self.lens = lens or LensExtractionAgent()
        self.rules = rules or DeterministicTriageRules()

    def run(self, file_path: str | Path, file_name: str) -> AgentWorkflowResult:
        trace: list[AgentTrace] = []
        overall_start = time.perf_counter()
        tower_start = time.perf_counter()
        try:
            classification = self.tower.run(file_path, file_name)
            trace.append(AgentTrace(agent="TOWER", status="completed",
                duration_ms=int((time.perf_counter() - tower_start) * 1000),
                summary=f"Classified document as {classification.get('document_type', 'other')}.",
                details={"document_type": classification.get("document_type"),
                         "confidence": classification.get("confidence")}))
        except Exception as exc:
            logger.exception("TOWER failed for %s", file_name)
            trace.append(AgentTrace(agent="TOWER", status="failed",
                duration_ms=int((time.perf_counter() - tower_start) * 1000),
                summary=f"Classification failed: {type(exc).__name__}."))
            raise RuntimeError(f"TOWER classification failed: {type(exc).__name__}") from exc

        lens_start = time.perf_counter()
        try:
            extraction = self.lens.run(file_path, classification)
            trace.append(AgentTrace(agent="LENS", status=extraction.get("status", "completed"),
                duration_ms=int((time.perf_counter() - lens_start) * 1000),
                summary=extraction.get("reason", "Extraction step completed."),
                details={"job_id": extraction.get("raw_job", {}).get("id"),
                         "job_status": extraction.get("raw_job", {}).get("status")}))
        except Exception as exc:
            logger.exception("LENS failed for %s", file_name)
            trace.append(AgentTrace(agent="LENS", status="failed",
                duration_ms=int((time.perf_counter() - lens_start) * 1000),
                summary=f"Extraction failed: {type(exc).__name__}."))
            raise RuntimeError(f"LENS extraction failed: {type(exc).__name__}") from exc

        rules_start = time.perf_counter()
        try:
            converted = extraction.get("converted", {})
            triage = self.rules.run(file_name=file_name, classification=classification, converted=converted)
            trace.append(AgentTrace(agent="FINANCE_RULES", status="completed",
                duration_ms=int((time.perf_counter() - rules_start) * 1000),
                summary="Deterministic triage rules evaluated the classified and extracted document.",
                details={"review_required": triage.get("review_required"),
                         "missing_fields": triage.get("missing_fields", [])}))
        except Exception as exc:
            logger.exception("Finance rules failed for %s", file_name)
            trace.append(AgentTrace(agent="FINANCE_RULES", status="failed",
                duration_ms=int((time.perf_counter() - rules_start) * 1000),
                summary=f"Rule evaluation failed: {type(exc).__name__}."))
            raise RuntimeError(f"Finance rules failed: {type(exc).__name__}") from exc

        blocking: list[str] = []
        if triage.get("review_required"):
            blocking.append("TRIAGE_REVIEW_REQUIRED")
        if classification.get("document_type") in {"invoice", "credit_note"} and extraction.get("status") != "completed":
            blocking.append("EXTRACTION_NOT_COMPLETED")
        validation = {
            "blocking": blocking,
            "triage_review_reason": triage.get("review_reason"),
            "missing_fields": triage.get("missing_fields", []),
            "confidence": triage.get("confidence"),
            "checks": {"vendor": "not_checked", "po": "not_checked", "tax": "not_checked", "duplicate": "not_checked"},
            "ai_core": classification,
            "document_ai_job_id": extraction.get("raw_job", {}).get("id"),
            "document_ai_status": extraction.get("raw_job", {}).get("status"),
            "agent_trace": [entry.model_dump() for entry in trace],
            "agent_flow_duration_ms": int((time.perf_counter() - overall_start) * 1000),
        }
        return AgentWorkflowResult(classification=classification, extraction=extraction,
                                   triage=triage, agent_trace=trace, validation=validation)
