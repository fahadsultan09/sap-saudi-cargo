"""Main triage pipeline runner — no external API required.

This module orchestrates the standalone pipeline steps. It accepts
classification_extraction and detailed_extraction data directly (e.g. from a
JSON payload or from SAP AI Core classification + SAP Document AI
extraction), so it can run entirely offline without any external API server.

Usage (programmatic)::

    from triage.runner import run_triage

    result = run_triage(
        classification_extraction=entities,
        detailed_extraction=entities,
        line_items=[{"description": "Air Freight"}],
    )
    print(json.dumps(result, indent=2))

Usage (CLI)::

    python run.py data/doc_ai_payload.json          # SAP Document AI payload
    python run.py data/doc_ai_payload.json 2         # third document (0-indexed)
    python run.py data/doc_ai_payload.json all       # all documents
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Any

from .types import DocumentType
from .pipeline import (
    _EXTRACTABLE_TYPES,
    build_triage_result,
    classify_invoice_type,
    determine_document_type,
    extract_detailed_fields,
    normalize_payload,
    review_node,
    validate_extraction,
)
from .state import TriageState, initial_state

logger = logging.getLogger("triage_agent")


def run_triage(
    *,
    classification_extraction: list[dict[str, Any]],
    detailed_extraction: list[dict[str, Any]] | None = None,
    line_items: list[dict[str, Any]] | None = None,
    file_name: str = "",
    ai_core_classification: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run the full triage pipeline on pre-supplied extraction data.

    Args:
        classification_extraction: DocumentEntity list for classification steps.
        detailed_extraction: DocumentEntity list for detailed field extraction.
            Defaults to classification_extraction if not provided.
        line_items: Pre-supplied line items from the source data.
        file_name: Optional file name for evidence logging.
        ai_core_classification: Validated AI Core result
            ({"document_type": "invoice", "confidence": ..., "reason": ...}).
            When it carries a document_type it decides the document type.

    Returns:
        The TriageResult as a dict.
    """
    detailed_extraction = detailed_extraction or classification_extraction

    state: TriageState = initial_state(
        file_name=file_name,
        classification_extraction=classification_extraction,
        detailed_extraction=detailed_extraction,
        line_items=line_items,
        ai_core_classification=ai_core_classification,
    )

    # -- Steps 1-2: Classify document type -------------------------------
    state = determine_document_type(state)

    # -- Branch: not valid AP -> review -> return -------------------------
    if state.get("document_type", DocumentType.OTHER.value) not in _EXTRACTABLE_TYPES:
        logger.info("Document type not valid AP -> review")
        state = review_node(state)
        state = build_triage_result(state)
        return state.get("triage_result", {})

    # -- Steps 3-6: Full extraction pipeline -----------------------------
    state = classify_invoice_type(state)
    state = extract_detailed_fields(state)
    state = validate_extraction(state)
    state = build_triage_result(state)
    return state.get("triage_result", {})


def run_triage_from_payload(raw_data: dict[str, Any], doc_index: int = 0) -> dict[str, Any]:
    """Normalise a raw JSON payload then run the triage pipeline.

    Accepts SAP Document AI payload format, sample_data.json format, or a
generic dict with headerFields/lineItems.
    """
    normalized = normalize_payload(raw_data, doc_index)
    invoice_source = normalized["invoice_source"]
    return run_triage(
        classification_extraction=normalized["classification_extraction"],
        detailed_extraction=normalized["detailed_extraction"],
        line_items=normalized.get("line_items", []),
        file_name=invoice_source.get("file_name", ""),
    )


# ── CLI helpers ─────────────────────────────────────────────────────────────


def _load_json_file(file_path: str) -> dict[str, Any]:
    """Load a JSON file, trying absolute and relative paths."""
    p = Path(file_path)
    if not p.is_absolute():
        try:
            script_dir = Path(__file__).resolve().parent.parent.parent
        except NameError:
            script_dir = Path.cwd()
        relative = script_dir / file_path
        if relative.exists():
            p = relative
    if not p.exists():
        raise FileNotFoundError(f"JSON file not found: {file_path}")
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def _get_doc_count(raw_data: dict[str, Any]) -> int:
    """Return the number of documents in the JSON, or 1 for single-doc formats."""
    if "processed" in raw_data:
        return len(raw_data["processed"])
    return 1


def main(argv: list[str] | None = None) -> None:
    """CLI entry point.

    Usage:
        python run.py [json_file] [doc_index|all]
    """
    if argv is None:
        argv = sys.argv[1:]

    json_file = argv[0] if argv else "data/doc_ai_payload.json"

    try:
        raw_data = _load_json_file(json_file)
    except FileNotFoundError as e:
        print(f"ERROR: {e}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"ERROR: Invalid JSON in {json_file}: {e}")
        sys.exit(1)

    doc_count = _get_doc_count(raw_data)

    if len(argv) > 1:
        arg = argv[1]
        if arg == "all":
            indices = list(range(doc_count))
        else:
            try:
                idx = int(arg)
                if idx < 0 or idx >= doc_count:
                    print(f"ERROR: doc_index {idx} out of range (0-{doc_count - 1})")
                    sys.exit(1)
                indices = [idx]
            except ValueError:
                print(f"ERROR: Invalid doc_index '{arg}' -- use an integer or 'all'")
                sys.exit(1)
    else:
        indices = [0]

    print(f"\n  Source: {json_file} ({doc_count} document(s) available)")
    print(f"  Processing: {len(indices)} document(s) at index(es): {indices}")

    for i, doc_idx in enumerate(indices):
        if len(indices) > 1:
            print(f"\n{'#' * 80}")
            print(f"#  DOCUMENT {i + 1}/{len(indices)}  (index {doc_idx})")
            print(f"{'#' * 80}")

        try:
            result = run_triage_from_payload(raw_data, doc_idx)
        except (ValueError, KeyError) as e:
            print(f"ERROR processing document {doc_idx}: {e}")
            continue

        print("\n" + "=" * 80)
        print(f"  TRIAGE RESULT{'  [doc ' + str(doc_idx) + ']' if len(indices) > 1 else ''}")
        print("=" * 80)
        print(json.dumps(result, indent=2, default=str, ensure_ascii=False))

        print("\n" + "=" * 80)
        print("  EVIDENCE TRAIL")
        print("=" * 80)
        for j, e in enumerate(result.get("evidence", []), 1):
            print(f"  {j:2d}. {e}")

    print()
