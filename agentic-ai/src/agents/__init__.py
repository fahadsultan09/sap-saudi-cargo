"""Minimal agent layer for the SACC AP proof of concept.

Tier 1 deliberately implements TOWER (classification), LENS (SAP Document AI
extraction), and deterministic triage. VECTOR and PRISM are deferred until
trusted SAP business-data adapters and exception-investigation requirements exist.
"""

from .orchestrator import APAgentOrchestrator

__all__ = ["APAgentOrchestrator"]
