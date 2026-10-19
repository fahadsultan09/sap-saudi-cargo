"""Standalone pipeline step functions for the AP Invoice Triage Agent.

Every function in this module operates purely on the TriageState dict —
no HTTP calls, no database access, no external API dependencies. This makes
the entire classification and validation pipeline testable in isolation and
deployable without the SACC mock API server.

Workflow:
    1.  Document type determination (AI Core classification)
    2.  Invoice type classification (FUEL / CARGO / CHARTER / SERVICE / OTHER)
    3.  Detailed field extraction
    4.  Validation (required fields, confidence thresholds, line items)
    5.  TriageResult construction
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from .config import (
    DOCUMENT_TYPES_FILE,
    MIN_CONFIDENCE_THRESHOLD,
    MIN_REQUIRED_FIELD_CONFIDENCE,
)
from .types import (
    DocumentType,
    InvoiceType,
    TriageResult,
)
from .state import TriageState

logger = logging.getLogger("triage_agent")

# ── Document type categories (loaded once at import time) ──────────────────

_DOCUMENT_TYPES_FILE = DOCUMENT_TYPES_FILE
with open(_DOCUMENT_TYPES_FILE, "r", encoding="utf-8") as _f:
    _DOCUMENT_TYPES_DATA = json.load(_f)

_DOCUMENT_TYPE_CATEGORIES = [
    (item["category"], item["document_type"])
    for item in _DOCUMENT_TYPES_DATA["categories"]
]

_CATEGORY_TO_DOC_TYPE = {
    "Invoice": DocumentType.INVOICE,
    "Credit Note": DocumentType.CREDIT_NOTE,
    "Statement of Account": DocumentType.STATEMENT,
    "Supporting Document": DocumentType.SUPPORTING_DOCUMENT,
    "Reconciliation": DocumentType.RECONCILIATION,
    "Purchase Order List": DocumentType.PURCHASE_ORDER_LIST,
    "General Correspondence": DocumentType.GENERAL_CORRESPONDENCE,
}

# Mapping from AI Core (GPT-5.4) lowercase document_type values to pipeline enums
_AI_CORE_TYPE_MAP = {
    "invoice": DocumentType.INVOICE,
    "credit_note": DocumentType.CREDIT_NOTE,
    "supporting_document": DocumentType.SUPPORTING_DOCUMENT,
    "reconciliation": DocumentType.RECONCILIATION,
    "statement_of_account": DocumentType.STATEMENT,
    "purchase_order_list": DocumentType.PURCHASE_ORDER_LIST,
    "general_correspondence": DocumentType.GENERAL_CORRESPONDENCE,
}

INVOICE_PROCESSABLE_TYPES = {
    DocumentType.INVOICE,
    DocumentType.CREDIT_NOTE,
}

# Only these go through invoice-type / field extraction. Everything
# else (statements, PO lists, correspondence, ...) is routed to review untouched.
_EXTRACTABLE_TYPES = {
    DocumentType.INVOICE.value,
    DocumentType.CREDIT_NOTE.value,
}

# Header fields an invoice must have (canonical snake_case names).
REQUIRED_HEADER_FIELDS = [
    "invoice_number",
    "invoice_date",
    "supplier_name",
    "total_amount",
    "currency",
]

# SAP Document AI (DOX) returns camelCase field names; map them to the
# canonical names used by the pipeline. Both spellings stay available.
DOX_FIELD_ALIASES = {
    "documentNumber": "invoice_number",
    "documentDate": "invoice_date",
    "senderName": "supplier_name",
    "receiverName": "company_name",
    "grossAmount": "total_amount",
    "netAmount": "net_amount",
    "taxAmount": "tax_amount",
    "currencyCode": "currency",
    "purchaseOrderNumber": "po_number",
    "paymentTerms": "payment_terms",
}


# Required fields depend on the document type and business rules.
# These are initial defaults; adapt them to your AP policy.
DEFAULT_REQUIRED_FIELDS = [
    "invoice_number",
    "invoice_date",
    "supplier_name",
    "total_amount",
    "currency",
]

REQUIRED_FIELDS_BY_INVOICE_TYPE = {
    "FUEL": DEFAULT_REQUIRED_FIELDS,
    "CARGO": DEFAULT_REQUIRED_FIELDS,
    "CHARTER": DEFAULT_REQUIRED_FIELDS,
    "SERVICE": DEFAULT_REQUIRED_FIELDS,
    "OTHER": DEFAULT_REQUIRED_FIELDS,
}

CONDITIONAL_FIELDS_BY_INVOICE_TYPE = {
    "FUEL": ["po_number"],
    "CARGO": ["po_number"],
    "CHARTER": ["po_number"],
    "SERVICE": ["po_number"],
    "OTHER": [],
}


# Field-name fragments that hold addresses / bank / contact data; ignored for
# invoice-type keyword matching.
_NON_KEYWORD_PARTS = ("address", "bank", "iban", "swift", "email", "phone", "vat", "street", "city", "country")


# ── Helper functions ───────────────────────────────────────────────────────


def _to_float(value: Any) -> float:
    """Best-effort numeric parse ('1,200.50' -> 1200.5); 0.0 if unparseable."""
    try:
        return float(str(value).replace(",", "").strip() or 0)
    except ValueError:
        return 0.0


def extract_value(entity: dict[str, Any]) -> str:
    """Extract the string value from a DocumentEntity record."""
    return (
        entity.get("stringValue")
        or str(entity.get("numberValue", "") or "")
        or entity.get("dateValue", "")
        or entity.get("rawValue", "")
        or ""
    )


def build_lookup(extraction: list[dict[str, Any]]) -> dict[str, str]:
    """Build a name -> value lookup from a list of DocumentEntity records.

    DOX camelCase names are also exposed under their canonical snake_case name.
    """
    lookup: dict[str, str] = {}
    for entity in extraction:
        name = entity.get("name", "")
        value = extract_value(entity)
        if name and value:
            lookup[name] = str(value)
            alias = DOX_FIELD_ALIASES.get(name)
            if alias and alias not in lookup:
                lookup[alias] = str(value)
    return lookup


def convert_header_fields(header_fields: dict[str, Any]) -> list[dict[str, Any]]:
    """Convert a headerFields dict (SAP Doc AI format) to DocumentEntity list.

    Only converts the data format — does NOT map or derive any field names.
    """
    entities: list[dict[str, Any]] = []
    for name, field_data in header_fields.items():
        if isinstance(field_data, dict) and ("value" in field_data or "confidence" in field_data):
            value = field_data.get("value", "")
            confidence = float(field_data.get("confidence", 0.0) or 0.0)
        else:
            value = field_data
            confidence = 0.85

        entity: dict[str, Any] = {"name": name, "confidence": confidence}
        if isinstance(value, bool):
            entity["type"] = "string"
            entity["stringValue"] = str(value)
        elif isinstance(value, (int, float)):
            entity["type"] = "number"
            entity["numberValue"] = value
        else:
            entity["type"] = "string"
            entity["stringValue"] = str(value) if value is not None else ""
        entities.append(entity)
    return entities


def normalize_payload(raw_data: dict[str, Any], doc_index: int = 0) -> dict[str, Any]:
    """Convert a JSON payload (SAP Doc AI or generic) to the triage-expected format.

    Returns a dict with:
        classification_extraction: list of DocumentEntity dicts
        detailed_extraction: list of DocumentEntity dicts
        invoice_source: dict of key header fields
        line_items: list of line-item dicts
    """
    # sample_data.json format — already in DocumentEntity format
    if "classification_extraction" in raw_data:
        return {
            "classification_extraction": raw_data.get("classification_extraction", []),
            "detailed_extraction": raw_data.get("detailed_extraction", []),
            "invoice_source": raw_data.get("invoice_source", {}),
            "line_items": raw_data.get("line_items", []),

            # IMPORTANT: preserve SAP AI Core classification
            "ai_core_classification": raw_data.get("ai_core_classification", {}),
        }

    # doc_ai_payload.json format — has processed[] array
    if "processed" in raw_data:
        processed = raw_data["processed"]
        if not processed:
            raise ValueError("No 'processed' documents in payload")
        if doc_index >= len(processed):
            raise ValueError(f"doc_index {doc_index} out of range (0-{len(processed) - 1})")
        doc = processed[doc_index]
    elif "headerFields" in raw_data or "header_fields" in raw_data:
        doc = raw_data
    else:
        # Generic — treat entire dict as header fields
        doc = {
            "attachment": raw_data.get("file_name", raw_data.get("attachment", "")),
            "headerFields": {
                k: v for k, v in raw_data.items()
                if k not in ("lineItems", "line_items") and isinstance(v, (str, int, float, dict))
            },
            "lineItems": raw_data.get("lineItems", raw_data.get("line_items", [])),
        }

    header_fields = doc.get("headerFields", doc.get("header_fields", {}))
    line_items = doc.get("lineItems", doc.get("line_items", []))

    entities = convert_header_fields(header_fields)

    # Build invoice_source from what's in the payload (no derivation)
    values: dict[str, str] = {}
    for e in entities:
        val = e.get("stringValue") or str(e.get("numberValue", "") or "") or ""
        if val:
            values[e["name"]] = str(val)

    invoice_source = {
        "file_name": doc.get("attachment", ""),
    }
    for key, alt_keys in {
        "invoice_number": ["invoice_number", "documentNumber"],
        "invoice_date": ["invoice_date", "documentDate"],
        "supplier_name": ["supplier_name", "senderName"],
        "company_name": ["company_name", "receiverName"],
        "company_code": ["company_code"],
        "total_amount": ["total_amount", "grossAmount"],
        "currency": ["currency", "currencyCode"],
        "net_amount": ["net_amount", "netAmount"],
        "tax_amount": ["tax_amount"],
        "po_number": ["po_number", "purchaseOrderNumber"],
        "payment_terms": ["payment_terms", "paymentTerms"],
        "keywords": ["keywords"],
    }.items():
        for alt in alt_keys:
            if alt in values:
                invoice_source[key] = values[alt]
                break
        else:
            invoice_source[key] = ""

    return {
        "classification_extraction": entities,
        "detailed_extraction": entities,
        "invoice_source": invoice_source,
        "line_items": line_items,
    }


# ── Step 1: Determine Document Type ────────────────────────────────────────


def determine_document_type(state: TriageState) -> TriageState:
    """Determine document type using SAP AI Core classification or keyword fallback.

    Invoices and credit notes are eligible for invoice-related processing.
    Other document types are classified but do not continue through the
    invoice-processing pipeline.
    """
    logger.info("Step 1: Determining document type...")

    evidence = list(state.get("evidence", []))
    extraction = state.get("classification_extraction", [])
    extracted_values = build_lookup(extraction)

    doc_type = DocumentType.OTHER

    ai_core_classification = state.get("ai_core_classification", {})
    ai_core_type = str(
        ai_core_classification.get("document_type", "")
    ).strip().lower()

    # Step 1: Prefer a recognized SAP AI Core classification.
    if ai_core_type and ai_core_type in _AI_CORE_TYPE_MAP:
        doc_type = _AI_CORE_TYPE_MAP[ai_core_type]

        evidence.append(
            f"Document type determined: {doc_type.value} "
            f"(from SAP AI Core classification: '{ai_core_type}')"
        )

        logger.info(
            "Document type: %s (from AI Core)",
            doc_type.value,
        )

    else:
        # Step 2: Fall back to keyword classification if necessary.
        if ai_core_classification.get("ai_parse_status") == "failed":
            evidence.append(
                "SAP AI Core classification failed validation "
                f"({ai_core_classification.get('error') or 'invalid reply'}); "
                "using keyword fallback."
            )

        search_text = " ".join(
            str(value)
            for value in (
                extracted_values.get("document_type", ""),
                state.get("file_name", ""),
            )
            if value
        ).lower().replace("_", " ")

        for category, doc_types in _DOCUMENT_TYPE_CATEGORIES:
            mapped_type = _CATEGORY_TO_DOC_TYPE.get(category)

            if mapped_type and any(
                str(keyword).lower().replace("_", " ") in search_text
                for keyword in doc_types
            ):
                doc_type = mapped_type
                break

        evidence.append(
            f"Document type determined: {doc_type.value} "
            "(keyword fallback)"
        )

        logger.info(
            "Document type: %s (keyword fallback)",
            doc_type.value,
        )

    # Step 3: Explicit allowlist for invoice-related processing.
    # Ensure CREDIT_NOTE exists in your DocumentType enum.
    invoice_processable_types = {
        DocumentType.INVOICE,
        DocumentType.CREDIT_NOTE,
    }

    should_process_invoice = doc_type in invoice_processable_types

    if should_process_invoice:
        evidence.append(
            f"Document type '{doc_type.value}' is eligible "
            "for invoice-related processing."
        )
        logger.info(
            "Invoice-related processing enabled for %s",
            doc_type.value,
        )
    else:
        evidence.append(
            f"Document type '{doc_type.value}' is not eligible "
            "for automatic invoice-related processing. "
            "Downstream invoice agents must be skipped."
        )
        logger.info(
            "Skipping invoice-related processing for %s",
            doc_type.value,
        )

    # Step 4: Return the updated state.
    return {
        **state,
        "document_type": doc_type.value,
        "should_process_invoice": should_process_invoice,
        "evidence": evidence,
    }

# ── Step 3: Determine Invoice Type ─────────────────────────────────────────


def classify_invoice_type(state: TriageState) -> TriageState:
    """Determine the invoice type: FUEL, CARGO, CHARTER, SERVICE, or OTHER.

    Uses keyword matching on extracted text from SAP Document AI (DOX)
    extraction results. This applies to all invoices (both Saudia Cargo
    and Saudia Airline).
    """
    logger.info("Step 3: Determining invoice type...")
    evidence = state.get("evidence", [])
    extraction = state.get("classification_extraction", [])
    extracted_values = build_lookup(extraction)

    # Match on everything except address / bank / contact fields, which
    # cause false hits (e.g. "Cargo Street", "Service Bank").
    parts = [
        v for k, v in extracted_values.items()
        if not any(x in k.lower() for x in _NON_KEYWORD_PARTS)
    ]
    for item in state.get("line_items") or []:
        if isinstance(item, dict):
            parts.append(str(item.get("description") or ""))
    combined = " ".join(parts).lower()

    def _has(words: list[str]) -> bool:
        return any(re.search(r"(?<!\w)" + re.escape(w) + r"(?!\w)", combined) for w in words)

    invoice_type = InvoiceType.OTHER
    reasons: list[str] = []

    fuel_keywords = ["fuel", "jet fuel", "avgas", "jet-a", "jet a1", "aviation fuel",
                     "fuel surcharge", "gallons", "litres", "uplift", "into-plane", "fueling", "refuel"]
    if _has(fuel_keywords):
        invoice_type = InvoiceType.FUEL
        reasons.append("Fuel keywords detected in extracted text")

    cargo_keywords = ["air waybill", "awb", "air freight", "general cargo", "air cargo",
                     "cargo handling", "freight charges", "chargeable weight"]
    if invoice_type == InvoiceType.OTHER and _has(cargo_keywords):
        invoice_type = InvoiceType.CARGO
        reasons.append("Cargo keywords detected in extracted text")

    charter_keywords = ["charter", "acmi", "wet lease", "dry lease", "aircraft charter",
                        "charter flight", "private flight", "air taxi"]
    if invoice_type == InvoiceType.OTHER and _has(charter_keywords):
        invoice_type = InvoiceType.CHARTER
        reasons.append("Charter keywords detected in extracted text")

    service_keywords = ["service", "services", "maintenance", "repair", "overhaul", "mro",
                        "ground handling", "catering", "cleaning", "consulting",
                        "professional services", "facility"]
    if invoice_type == InvoiceType.OTHER and _has(service_keywords):
        invoice_type = InvoiceType.SERVICE
        reasons.append("Service keywords detected in extracted text")

    if invoice_type == InvoiceType.OTHER:
        reasons.append("No specific invoice type keywords detected -- classified as OTHER")

    evidence.append(f"Invoice type: {invoice_type.value} (keyword match). " + "; ".join(reasons))
    logger.info("Invoice type: %s (keyword match)", invoice_type.value)
    return {**state, "invoice_type": invoice_type.value, "evidence": evidence}


# ── Step 4: Extract Detailed Fields ────────────────────────────────────────


def extract_detailed_fields(state: TriageState) -> TriageState:
    """Parse pre-supplied extraction entities into header fields and line items.

    This is a pure-data function — it reads the ``detailed_extraction`` list
    from state (populated by the caller, not by an API call) and splits it
    into header fields (name -> value with confidence) and line items.
    """
    logger.info("Step 4: Extracting detailed fields...")
    evidence = state.get("evidence", [])
    detailed_extraction = state.get("detailed_extraction", [])

    header_fields: dict[str, Any] = {}
    field_confidences: dict[str, float] = {}
    line_items: list[dict[str, Any]] = []

    for entity in detailed_extraction:
        name = entity.get("name", "")
        confidence = float(entity.get("confidence", 0.0) or 0.0)
        value = extract_value(entity)
        if not name:
            continue
        if name == "line_items" or entity.get("type") == "collection":
            continue
        name = DOX_FIELD_ALIASES.get(name, name)  # documentNumber -> invoice_number, ...
        header_fields[name] = value
        field_confidences[name] = confidence

    # Simulate a single line item from header data if no line items were
    # explicitly provided and we have a total_amount.
    if not line_items and not state.get("line_items") and header_fields.get("total_amount"):
        line_items.append({
            "item_number": "00001",
            "description": header_fields.get("invoice_number", "Line item 1"),
            "quantity": 1,
            "unit_price": _to_float(header_fields.get("total_amount")),
            "total_amount": _to_float(header_fields.get("total_amount")),
            "gl_account": "", "cost_center": "", "tax_code": "",
            "confidence": 0.0,
        })

    # If line items were supplied in state (e.g. from source JSON), keep them
    if state.get("line_items"):
        line_items = state["line_items"]

    evidence.append(
        f"Detailed extraction complete: {len(header_fields)} header fields, "
        f"{len(line_items)} line items"
    )
    logger.info("Detailed extraction: %d header fields, %d line items",
                len(header_fields), len(line_items))
    return {**state, "detailed_extraction": detailed_extraction,
            "header_fields": header_fields, "field_confidences": field_confidences,
            "line_items": line_items, "evidence": evidence}


# ── Step 5: Validate Extraction ─────────────────────────────────────────────


def validate_extraction(state: TriageState) -> TriageState:
    """Validate extraction confidence and required fields."""
    logger.info("Step 5: Validating extraction...")
    evidence = state.get("evidence", [])
    invoice_type = state.get("invoice_type", InvoiceType.OTHER.value)
    header_fields = state.get("header_fields", {})
    field_confidences = state.get("field_confidences", {})
    line_items = state.get("line_items", [])

    required_fields = REQUIRED_FIELDS_BY_INVOICE_TYPE.get(
        invoice_type,
        DEFAULT_REQUIRED_FIELDS,
    )

    conditional_fields = CONDITIONAL_FIELDS_BY_INVOICE_TYPE.get(
        invoice_type,
        [],
    )

    missing_required = [
        field
        for field in required_fields
        if not header_fields.get(field)
    ]

    low_confidence = [
        field
        for field in required_fields
        if field in field_confidences
        and field_confidences[field] < MIN_REQUIRED_FIELD_CONFIDENCE
    ]

    missing_conditional = [
        field
        for field in conditional_fields
        if not header_fields.get(field)
    ]

    missing_required = [
        f for f in required_fields if f not in header_fields or not header_fields[f]
    ]
    low_confidence = [
        f for f, conf in field_confidences.items()
        if conf < MIN_REQUIRED_FIELD_CONFIDENCE and f in required_fields
    ]

    # Overall confidence = mean over the required fields that were found, so
    # low-confidence optional fields (addresses, bank data...) don't force review.
    scored = [field_confidences[f] for f in required_fields if f in field_confidences]
    if not scored:
        scored = list(field_confidences.values())
    overall_confidence = sum(scored) / len(scored) if scored else 0.0

    review_reasons: list[str] = []
    if missing_required:
        review_reasons.append(f"Missing required fields: {', '.join(missing_required)}")
    if low_confidence:
        review_reasons.append(f"Low confidence on required fields: {', '.join(low_confidence)}")
    if overall_confidence < MIN_CONFIDENCE_THRESHOLD:
        review_reasons.append(
            f"Overall confidence {overall_confidence:.2f} below threshold {MIN_CONFIDENCE_THRESHOLD}"
        )
    if not line_items:
        review_reasons.append("No line items extracted")

    review_required = len(review_reasons) > 0
    review_reason = "; ".join(review_reasons) if review_reasons else None

    if missing_conditional:
        evidence.append(
            "Conditional fields missing: "
            + ", ".join(missing_conditional)
        )

    evidence.append(
        f"Validation: confidence={overall_confidence:.2f}, "
        f"missing={len(missing_required)}, low_conf={len(low_confidence)}, "
        f"review_required={review_required}"
    )
    if review_required:
        evidence.append(f"Review reason: {review_reason}")
    logger.info("Validation: confidence=%.2f, review_required=%s", overall_confidence, review_required)
    return {**state, "confidence": overall_confidence,
            "missing_required_fields": missing_required,
            "low_confidence_fields": low_confidence,
            "review_required": review_required,
            "review_reason": review_reason, "evidence": evidence}


# ── Step 6: Build Triage Result ─────────────────────────────────────────────


def build_triage_result(state: TriageState) -> TriageState:
    """Build and return the strict JSON TriageResult."""
    logger.info("Step 6: Building TriageResult...")
    result = TriageResult(
        document_type=state.get("document_type", DocumentType.OTHER.value),
        invoice_type=state.get("invoice_type", InvoiceType.OTHER.value),
        extracted_header_fields=state.get("header_fields", {}),
        line_items=state.get("line_items", []),
        confidence=state.get("confidence", 0.0),
        evidence=state.get("evidence", []),
        review_required=state.get("review_required", True),
        review_reason=state.get("review_reason"),
        missing_fields=state.get("missing_required_fields", []),
        workflow_steps=state.get("workflow_steps", []),
    )
    result_dict = result.to_dict()
    logger.debug("TriageResult:\n%s", result.to_json())
    return {**state, "triage_result": result_dict}


# ── Review Node ─────────────────────────────────────────────────────────────


def review_node(state: TriageState) -> TriageState:
    """Handle documents that require manual review."""
    logger.info("Routing to REVIEW...")
    evidence = state.get("evidence", [])
    doc_type = state.get("document_type", DocumentType.OTHER.value)

    if doc_type == DocumentType.OTHER.value:
        reason = "Document type could not be determined (AI classification missing or invalid)"
    else:
        reason = (
            f"Document type '{doc_type}' is not an invoice or credit note; "
            "not sent to invoice extraction"
        )

    evidence.append(f"Review required: {reason}")
    result = TriageResult(
        document_type=doc_type,
        invoice_type=state.get("invoice_type", InvoiceType.OTHER.value),
        extracted_header_fields=state.get("header_fields", {}),
        line_items=state.get("line_items", []),
        confidence=state.get("confidence", 0.0),
        evidence=evidence, review_required=True, review_reason=reason,
    )
    return {**state, "review_required": True, "review_reason": reason,
            "triage_result": result.to_dict(), "evidence": evidence}
