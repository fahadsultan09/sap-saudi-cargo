"""SACC-POC-Triage: Standalone AP Invoice Triage Agent.

A production-ready pipeline that triages AP invoices using pure Python
classification and validation logic. No external API server required —
extraction data is passed in directly.

Optional: SAP AI Core for document classification via
GPT-5.4 vision (see ``triage.ai_core`` module) and SAP Document AI
for invoice field extraction (see ``triage.doc_ai`` module).

Public API::

    from triage import run_triage, run_triage_from_payload
    from triage import TriageResult, TriageState
    from triage import DocumentType, InvoiceType
    from triage import AICoreClient, run_triage_with_ai_core
    from triage import run_triage_with_email_and_attachment
    from triage import DocAIClient, run_triage_with_doc_ai
"""

from .types import (
    DocumentType,
    ExtractedField,
    InvoiceType,
    LineItem,
    TriageResult,
)
from .pipeline import (
    build_lookup,
    build_triage_result,
    classify_invoice_type,
    convert_header_fields,
    determine_document_type,
    extract_detailed_fields,
    extract_value,
    normalize_payload,
    review_node,
    validate_extraction,
)
from .ai_core import AICoreClient, run_triage_with_ai_core, run_triage_with_email_and_attachment
from .doc_ai import DocAIClient, run_triage_with_doc_ai
from .runner import run_triage, run_triage_from_payload
from .state import TriageState, initial_state

__all__ = [
    # Models
    "DocumentType",
    "ExtractedField",
    "InvoiceType",
    "LineItem",
    "TriageResult",
    # State
    "TriageState",
    "initial_state",
    # Pipeline steps
    "build_lookup",
    "build_triage_result",
    "classify_invoice_type",
    "convert_header_fields",
    "determine_document_type",
    "extract_detailed_fields",
    "extract_value",
    "normalize_payload",
    "review_node",
    "validate_extraction",
    # Runner
    "run_triage",
    "run_triage_from_payload",
    # SAP AI Core (classification — requires requests + pymupdf + credentials)
    "AICoreClient",
    "run_triage_with_ai_core",
    "run_triage_with_email_and_attachment",
    # SAP Document AI (extraction — requires requests + credentials)
    "DocAIClient",
    "run_triage_with_doc_ai",
]

__version__ = "1.0.0"
