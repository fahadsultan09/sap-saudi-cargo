"""Workflow orchestrator — connects Email Intake Agent to Triage Agent.

Public API::

    from workflow import run_workflow, run_workflow_standalone, triage_documents
"""

from .orchestrator import run_workflow, run_workflow_standalone, triage_documents

__all__ = [
    "run_workflow",
    "run_workflow_standalone",
    "triage_documents",
]

__version__ = "1.0.0"
