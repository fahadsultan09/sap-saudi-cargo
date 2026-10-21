from __future__ import annotations

import logging
import time
from pathlib import Path
from collections.abc import Callable
from typing import Any

from pydantic import ValidationError

from .contracts import AgentTrace, AgentWorkflowResult
from .scanner import ScannerExtractionAgent
from .rules import DeterministicTriageRules
from .classifier import ClassifierTriageAgent
from .verifier import VerifierMatchingAgent
from .reconciler import ReconcilerInvestigationAgent
from .plumb import PlumbReconciliationAgent

logger = logging.getLogger("sacc_agents")


class APAgentOrchestrator:
    """Coordinates the minimum Tier 1 AP agent flow: CLASSIFIER -> SCANNER -> rules.

    It does not approve invoices, mutate case state, perform SAP matching, or
    post financial transactions. Those remain backend workflow responsibilities.
    """

    def __init__(
        self,
        *,
        classifier: Any | None = None,
        scanner: Any | None = None,
        rules: Any | None = None,
        verifier: Any | None = None,
        reconciler: Any | None = None,
        plumb: Any | None = None,
        source_check: Any | None = None,
    ):
        self.classifier = classifier or ClassifierTriageAgent()
        self.scanner = scanner or ScannerExtractionAgent()
        self.rules = rules or DeterministicTriageRules()
        self.verifier = verifier or VerifierMatchingAgent()
        self.reconciler = reconciler or ReconcilerInvestigationAgent()
        self.plumb = plumb or PlumbReconciliationAgent()
        # Optional: needs the SAP reference data readers (see api.workflow.build_agent_run).
        self.source_check = source_check

    def run(self, file_path: str | Path, file_name: str, *, extended_context: dict[str, Any] | None = None,
            on_progress: Callable[[dict[str, Any]], None] | None = None) -> AgentWorkflowResult:
        """on_progress receives each finished step (and each SAP data check) as it happens."""
        trace: list[AgentTrace] = []
        progress = on_progress or (lambda event: None)

        def record(entry: AgentTrace) -> None:
            trace.append(entry)
            progress({"type": "step", "step": entry.model_dump()})

        overall_start = time.perf_counter()
        classifier_start = time.perf_counter()
        try:
            classification = self.classifier.run(file_path, file_name)
            record(
                AgentTrace(
                    agent="CLASSIFIER",
                    status="completed",
                    duration_ms=int((time.perf_counter() - classifier_start) * 1000),
                    summary=f"Classified document as {classification.get('document_type', 'other')}.",
                    details={
                        "document_type": classification.get("document_type"),
                        "confidence": classification.get("confidence"),
                    },
                )
            )
        except Exception as exc:
            logger.exception("CLASSIFIER failed for %s", file_name)
            record(
                AgentTrace(
                    agent="CLASSIFIER",
                    status="failed",
                    duration_ms=int((time.perf_counter() - classifier_start) * 1000),
                    summary=f"Classification failed: {type(exc).__name__}.",
                )
            )
            raise RuntimeError(
                f"CLASSIFIER classification failed: {type(exc).__name__}"
            ) from exc

        scanner_start = time.perf_counter()
        try:
            extraction = self.scanner.run(file_path, classification)
            record(
                AgentTrace(
                    agent="SCANNER",
                    status=extraction.get("status", "completed"),
                    duration_ms=int((time.perf_counter() - scanner_start) * 1000),
                    summary=extraction.get("reason", "Extraction step completed."),
                    details={
                        "job_id": extraction.get("raw_job", {}).get("id"),
                        "job_status": extraction.get("raw_job", {}).get("status"),
                    },
                )
            )
        except Exception as exc:
            logger.exception("SCANNER failed for %s", file_name)
            record(
                AgentTrace(
                    agent="SCANNER",
                    status="failed",
                    duration_ms=int((time.perf_counter() - scanner_start) * 1000),
                    summary=f"Extraction failed: {type(exc).__name__}.",
                )
            )
            raise RuntimeError(f"SCANNER extraction failed: {type(exc).__name__}") from exc

        rules_start = time.perf_counter()
        try:
            converted = extraction.get("converted", {})
            triage = self.rules.run(
                file_name=file_name, classification=classification, converted=converted
            )
            record(
                AgentTrace(
                    agent="FINANCE_RULES",
                    status="completed",
                    duration_ms=int((time.perf_counter() - rules_start) * 1000),
                    summary="Deterministic triage rules evaluated the classified and extracted document.",
                    details={
                        "review_required": triage.get("review_required"),
                        "rules": triage.get("finance_rules", []),
                        "missing_fields": triage.get("missing_fields", []),
                    },
                )
            )
        except Exception as exc:
            logger.exception("Finance rules failed for %s", file_name)
            record(
                AgentTrace(
                    agent="FINANCE_RULES",
                    status="failed",
                    duration_ms=int((time.perf_counter() - rules_start) * 1000),
                    summary=f"Rule evaluation failed: {type(exc).__name__}.",
                )
            )
            raise RuntimeError(f"Finance rules failed: {type(exc).__name__}") from exc

        blocking: list[str] = []
        if triage.get("review_required"):
            blocking.append("TRIAGE_REVIEW_REQUIRED")
        if (
            classification.get("document_type") in {"invoice", "credit_note"}
            and extraction.get("status") != "completed"
        ):
            blocking.append("EXTRACTION_NOT_COMPLETED")
        validation = {
            "blocking": blocking,
            "triage_review_reason": triage.get("review_reason"),
            "finance_rules": triage.get("finance_rules", []),
            "missing_fields": triage.get("missing_fields", []),
            "confidence": triage.get("confidence"),
            "checks": {
                "vendor": "not_checked",
                "po": "not_checked",
                "tax": "not_checked",
                "duplicate": "not_checked",
            },
            "ai_core": classification,
            "document_ai_job_id": extraction.get("raw_job", {}).get("id"),
            "document_ai_status": extraction.get("raw_job", {}).get("status"),
            "agent_trace": [entry.model_dump() for entry in trace],
            "agent_flow_duration_ms": int((time.perf_counter() - overall_start) * 1000),
        }

        matching: dict[str, Any] = {}
        investigation: dict[str, Any] = {}
        reconciliation: dict[str, Any] = {}
        context = extended_context or {}
        
        
        run_extended = extended_context is not None

        converted = extraction.get("converted", {})
        invoice_fields = context.get("invoice_fields")

        if invoice_fields is None:
            invoice_fields = converted.get("invoice_source", {})

        # Normalize invoice fields for VERIFIER without inventing missing values.
        invoice_fields = dict(invoice_fields or {})

        if not invoice_fields.get("supplier_id"):
            invoice_fields["supplier_id"] = (
                invoice_fields.get("vendor_number") or ""
            )

        if not invoice_fields.get("po_number"):
            invoice_fields["po_number"] = (
                invoice_fields.get("purchase_order_number") or ""
            )

        if not invoice_fields.get("total_amount"):
            invoice_fields["total_amount"] = (
                invoice_fields.get("gross_amount") or ""
            )

        document_type = classification.get("document_type")
        sap_observation = context.get("sap_observation")
        
        
        # VERIFIER: run for invoices and credit notes when extended execution is enabled.
        # Missing PO/SAP evidence must remain UNKNOWN, not PASS.
        if run_extended and (
            document_type in {"invoice", "credit_note"}
            or "invoice_fields" in context
        ):
            started = time.perf_counter()
            try:
                matching = self.verifier.run(
                    invoice_fields or {},
                    sap_observation,
                )
                record(
                    AgentTrace(
                        agent="VERIFIER",
                        status="completed",
                        duration_ms=int(
                            (time.perf_counter() - started) * 1000
                        ),
                        summary=(
                            f"PO matching returned "
                            f"{matching.get('match_status', 'UNKNOWN')}."
                        ),
                        details={
                            "reason_codes": matching.get("reason_codes", []),
                            "missing_evidence": matching.get(
                                "missing_evidence", []
                            ),
                        },
                    )
                )
                validation["checks"]["po"] = matching.get(
                    "match_status", "UNKNOWN"
                )
            except Exception as exc:
                logger.exception("VERIFIER failed for %s", file_name)
                matching = {
                    "agent": "VERIFIER",
                    "status": "ERROR",
                    "match_status": "UNKNOWN",
                    "reason_codes": ["VERIFIER_EXECUTION_FAILED"],
                    "error_type": type(exc).__name__,
                }
                record(
                    AgentTrace(
                        agent="VERIFIER",
                        status="failed",
                        duration_ms=int(
                            (time.perf_counter() - started) * 1000
                        ),
                        summary=f"PO matching failed: {type(exc).__name__}.",
                    )
                )

        # Preserve full PO matching evidence for the API and reviewer UI.
        if matching:
            validation["verifier_matching"] = matching

        # SOURCE_CHECK: compare the invoice with the SAP reference data and write a verdict.
        source_verdict: dict[str, Any] = {}
        if run_extended and self.source_check is not None and document_type in {"invoice", "credit_note"}:
            started = time.perf_counter()
            try:
                source_verdict = self.source_check.run(
                    invoice_fields, on_check=lambda row: progress({"type": "check", "check": row})
                )
                record(
                    AgentTrace(
                        agent="SOURCE_CHECK",
                        status="completed",
                        duration_ms=int((time.perf_counter() - started) * 1000),
                        summary=source_verdict["summary"],
                        details={
                            "verdict": source_verdict["status"],
                            "discrepancies": len(source_verdict["discrepancies"]),
                        },
                    )
                )
                # The verdict compares more than VERIFIER does, so it decides the PO and vendor checks.
                outcome = {"MATCH": "PASS", "MISMATCH": "FAIL"}
                validation["checks"]["po"] = outcome.get(source_verdict["status"], "UNKNOWN")
                supplier = next((row for row in source_verdict["comparisons"] if row["check"] == "supplier"), None)
                validation["checks"]["vendor"] = (
                    {"MATCH": "PASS", "MISMATCH": "FAIL"}.get(supplier["result"], "UNKNOWN") if supplier else "UNKNOWN"
                )
            except Exception as exc:
                logger.exception("SOURCE_CHECK failed for %s", file_name)
                source_verdict = {
                    "agent": "SOURCE_CHECK",
                    "status": "ERROR",
                    "summary": f"The SAP data check could not run: {type(exc).__name__}.",
                    "comparisons": [],
                    "discrepancies": [],
                }
                record(
                    AgentTrace(
                        agent="SOURCE_CHECK",
                        status="failed",
                        duration_ms=int((time.perf_counter() - started) * 1000),
                        summary=source_verdict["summary"],
                    )
                )
            validation["source_verdict"] = source_verdict

        # RECONCILER: investigate rule findings and missing evidence.
        # No SAP observations are fabricated if none were supplied.
        if run_extended:
            started = time.perf_counter()
            try:
                rule_results = context.get("rule_results")
                if rule_results is None:
                    rule_results = []
                    if triage.get("review_required"):
                        rule_results.append({
                            "rule_code": "TRIAGE_REVIEW_REQUIRED",
                            "outcome": "FAIL",
                            "reason": triage.get("review_reason")
                            or "Finance rules require review.",
                        })

                    if triage.get("missing_fields"):
                        rule_results.append({
                            "rule_code": "REQUIRED_FIELDS_MISSING",
                            "outcome": "FAIL",
                            "reason": "One or more required fields are missing.",
                        })

                    if matching and matching.get("status") in {"FAIL", "UNKNOWN"}:
                        rule_results.append({
                            "rule_code": "VERIFIER_PO_MATCH",
                            "outcome": matching["status"],
                            "reason": ", ".join(
                                matching.get("reason_codes", [])
                            ) or "PO matching requires review.",
                        })

                    if source_verdict.get("status") in {"MISMATCH", "NOT_FOUND", "ERROR"}:
                        rule_results.append({
                            "rule_code": "SAP_DATA_CHECK",
                            "outcome": "FAIL" if source_verdict["status"] == "MISMATCH" else "UNKNOWN",
                            "reason": "; ".join(source_verdict.get("discrepancies", []))
                            or source_verdict.get("summary", ""),
                        })

                sap_observations = context.get("sap_observations", [])
                if sap_observation and not sap_observations:
                    sap_observations = [sap_observation]

                investigation = self.reconciler.run(
                    rule_results=rule_results,
                    sap_observations=sap_observations,
                    extraction={
                        "missing_fields": triage.get("missing_fields", [])
                    },
                )
                record(
                    AgentTrace(
                        agent="RECONCILER",
                        status="completed",
                        duration_ms=int(
                            (time.perf_counter() - started) * 1000
                        ),
                        summary=(
                            f"Investigation status: "
                            f"{investigation.get('status')}."
                        ),
                        details={
                            "finding_count": len(
                                investigation.get("findings", [])
                            )
                        },
                    )
                )
            except Exception as exc:
                logger.exception("RECONCILER failed for %s", file_name)
                investigation = {
                    "agent": "RECONCILER",
                    "status": "ERROR",
                    "recommendation": "manual_review",
                    "error_type": type(exc).__name__,
                }
                record(
                    AgentTrace(
                        agent="RECONCILER",
                        status="failed",
                        duration_ms=int(
                            (time.perf_counter() - started) * 1000
                        ),
                        summary=f"Investigation failed: {type(exc).__name__}.",
                    )
                )

        # PLUMB: run only for payment advice with actual reconciliation input.
        # Payment-advice extraction is a separate integration requirement.
        if run_extended and (document_type == "payment_advice" or "payment_advice" in context ):
            started = time.perf_counter()
            payment_advice = context.get("payment_advice")
            posted_invoices = context.get("posted_invoices")

            if payment_advice is not None and posted_invoices is not None:
                try:
                    reconciliation = self.plumb.run(
                        payment_advice,
                        posted_invoices,
                    )
                    record(
                        AgentTrace(
                            agent="PLUMB",
                            status="completed",
                            duration_ms=int(
                                (time.perf_counter() - started) * 1000
                            ),
                            summary=(
                                "Payment reconciliation candidates generated; "
                                "no financial state changed."
                            ),
                            details={
                                "matched_count": reconciliation.get(
                                    "matched_count", 0
                                ),
                                "unmatched_count": reconciliation.get(
                                    "unmatched_count", 0
                                ),
                            },
                        )
                    )
                except Exception as exc:
                    logger.exception("PLUMB failed for %s", file_name)
                    reconciliation = {
                        "agent": "PLUMB",
                        "status": "ERROR",
                        "side_effects_performed": False,
                        "error_type": type(exc).__name__,
                    }
                    record(
                        AgentTrace(
                            agent="PLUMB",
                            status="failed",
                            duration_ms=int(
                                (time.perf_counter() - started) * 1000
                            ),
                            summary=(
                                f"Reconciliation failed: "
                                f"{type(exc).__name__}."
                            ),
                        )
                    )
            else:
                reconciliation = {
                    "agent": "PLUMB",
                    "status": "INSUFFICIENT_INPUT",
                    "side_effects_performed": False,
                    "missing_inputs": [
                        name
                        for name, value in (
                            ("payment_advice", payment_advice),
                            ("posted_invoices", posted_invoices),
                        )
                        if value is None
                    ],
                }

        # Include all agent results in the final validation trace.
        validation["agent_trace"] = [
            entry.model_dump() for entry in trace
        ]
        validation["agent_flow_duration_ms"] = int(
            (time.perf_counter() - overall_start) * 1000
        )
        validation["matching"] = matching
        validation["investigation"] = investigation
        validation["reconciliation"] = reconciliation    
            
        return AgentWorkflowResult(
            classification=classification,
            extraction=extraction,
            triage=triage,
            agent_trace=trace,
            validation=validation,
            matching=matching,
            investigation=investigation,
            reconciliation=reconciliation,
        )
