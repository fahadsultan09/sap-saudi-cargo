"""Email-to-Triage Workflow Orchestrator.

Workflow:

    1. EMAIL INTAKE
       Fetch emails from Microsoft Graph and enrich them with
       body content, metadata, and attachments.

    2. TRIAGE AGENT
       For each email/document:
           a. SAP AI Core classifies the document using email metadata
              and attachment context.
           b. SAP Document AI (DOX) extracts detailed document data:
              classification, header fields, and line items.
           c. The extracted information + AI Core classification are
              passed to the pipeline for business processing.

The workflow can also run in standalone mode using pre-supplied
EmailMessage objects without Microsoft Graph.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import time
from typing import Any

from email_intake import (
    EmailMessage,
    run_intake,
    save_attachment_to_temp,
)
from triage import run_triage
from triage.config import OUTPUT_DIR

from .run_log import RunLog, append_dox_fields, row_from_result, save_dox_raw, setup_logging

logger = logging.getLogger("workflow")


# ── Triage Node ──────────────────────────────────────────────────────────────

# Attachment types AI Core (vision) and Document AI can read
SUPPORTED_EXTENSIONS = (".pdf", ".png", ".jpg", ".jpeg")


def _safe(text: str, limit: int = 50) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", text).strip("_")[:limit]


def save_attachment_copy(email: EmailMessage, attachment: dict[str, Any]) -> str:
    """Keep a permanent copy of an attachment (for manual review / later DMS upload).

    Saved to output/attachments/<received-date>_<subject>_<id>/<file name>.
    Returns the saved path, or "" if there is nothing to save (inline / no content).
    """
    content = attachment.get("contentBytes")
    if attachment.get("isInline") or not content:
        return ""
    folder = OUTPUT_DIR / "attachments" / (
        f"{(email.received_date or '')[:10]}_{_safe(email.subject) or 'no-subject'}_{_safe(email.message_id[-8:])}"
    )
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (_safe(attachment.get("name", "attachment"), 120) or "attachment")
    path.write_bytes(base64.b64decode(content))
    return str(path)


def download_attachments(emails: list[EmailMessage]) -> list[str]:
    """Download-only mode: save every non-inline attachment, no AI Core / Document AI."""
    saved: list[str] = []
    for email in emails:
        for attachment in email.attachments:
            path = save_attachment_copy(email, attachment)
            if path:
                logger.info("Saved %s", path)
                saved.append(path)
    logger.info("Downloaded %d attachment(s) to %s", len(saved), OUTPUT_DIR / "attachments")
    return saved


def _write_result(result: dict[str, Any], message_id: str, att_name: str) -> None:
    """Save the full triage result next to the CSV log."""
    out_dir = OUTPUT_DIR / "results"
    out_dir.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", f"{message_id[-12:]}_{att_name}")
    (out_dir / f"{safe}.json").write_text(
        json.dumps(result, indent=2, default=str, ensure_ascii=False), encoding="utf-8"
    )


def triage_documents(
    emails: list[EmailMessage],
    dry_run: bool = False,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Run the Triage Agent on document attachments.

    Per attachment: AI Core classifies the document (validated by Pydantic);
    invoices and credit notes go on to SAP Document AI for extraction; the
    triage pipeline then produces the result. Every attachment (processed,
    skipped or failed) gets one row in output/run_log.csv.

    Returns:
        (triage_results, errors)
    """
    if dry_run:
        logger.info("TRIAGE: DRY RUN - skipping triage (would triage %d emails)", len(emails))
        return [], []

    from triage.ai_core import AICoreClient, classification_for_triage
    from triage.doc_ai import DocAIClient

    triage_results: list[dict[str, Any]] = []
    errors: list[str] = []
    run_log = RunLog()
    ai_client: AICoreClient | None = None
    dox_client: DocAIClient | None = None

    logger.info("TRIAGE: Processing %d emails (run %s) ...", len(emails), run_log.run_id)

    for email in emails:
        logger.info("-" * 60)
        logger.info("Email: '%s' from %s", email.subject[:80], email.sender)
        mail = {
            "email_id": email.message_id,
            "subject": email.subject,
            "sender": email.sender,
            "received": email.received_date,
        }

        if not email.attachments:
            logger.info("  No attachments - skipping")
            run_log.add(**mail, status="skipped", error="no attachments")
            continue

        for attachment in email.attachments:
            att_name = attachment.get("name", "unknown")
            row = {
                **mail,
                "attachment_name": att_name,
                "attachment_size": attachment.get("size", ""),
                "saved_path": save_attachment_copy(email, attachment),
            }
            started = time.time()

            if attachment.get("isInline") or not att_name.lower().endswith(SUPPORTED_EXTENSIONS):
                logger.info("  Skipping attachment: %s", att_name)
                run_log.add(**row, status="skipped", error="inline or unsupported file type")
                continue

            temp_path = save_attachment_to_temp(attachment)
            if not temp_path:
                msg = f"Could not save attachment '{att_name}' from email '{email.subject}'"
                errors.append(msg)
                run_log.add(**row, status="error", error=msg)
                continue

            try:
                # 1. AI Core classification (validated, one repair retry)
                logger.info("  [1/3] Classifying '%s' via SAP AI Core ...", att_name)
                ai_client = ai_client or AICoreClient()
                classification = ai_client.upload_and_process(
                    temp_path,
                    email_metadata={
                        "subject": email.subject,
                        "sender": email.sender,
                        "received_date": email.received_date,
                        "body": email.body_content,
                        "attachment_name": att_name,
                    },
                )
                ai_cls = classification_for_triage(classification)
                logger.info(
                    "  AI Core: type=%s confidence=%.2f parse=%s",
                    ai_cls["document_type"], ai_cls["confidence"] or 0.0, ai_cls["ai_parse_status"],
                )

                # 2. Document AI extraction, only for invoices / credit notes
                converted = {"classification_extraction": [], "detailed_extraction": [], "line_items": []}
                extraction: dict[str, Any] = {}
                dox_raw_path = ""
                if ai_cls["document_type"] in ("invoice", "credit_note"):
                    logger.info("  [2/3] Extracting via SAP Document AI ...")
                    dox_client = dox_client or DocAIClient()
                    extraction = dox_client.upload_and_process(file_path=temp_path)
                    # Keep the raw Document AI response + a per-field confidence table
                    dox_raw_path = save_dox_raw(extraction, att_name, email.message_id)
                    append_dox_fields(run_log.run_id, att_name, extraction)
                    converted = DocAIClient.convert_results(extraction)
                else:
                    logger.info("  [2/3] Not an invoice/credit note - skipping Document AI")

                # 3. Triage business rules
                logger.info("  [3/3] Running triage ...")
                result = run_triage(
                    classification_extraction=converted["classification_extraction"],
                    detailed_extraction=converted["detailed_extraction"],
                    line_items=converted["line_items"] or None,
                    file_name=att_name,
                    ai_core_classification=ai_cls,
                )
                result["ai_core_classification"] = ai_cls
                result["sap_doc_ai"] = {
                    "job_id": extraction.get("id", ""),
                    "status": extraction.get("status", ""),
                    "raw_path": dox_raw_path,
                }
                result["email_context"] = {**mail, "attachment_name": att_name}

                _write_result(result, email.message_id, att_name)
                triage_results.append(result)
                run_log.add(
                    **{**row, **row_from_result(result)},
                    status="processed",
                    duration_s=round(time.time() - started, 1),
                )
                logger.info(
                    "  Result: type=%s review=%s",
                    result.get("document_type"),
                    result.get("review_required"),
                )

            except Exception as exc:
                logger.error("  Triage failed for '%s': %s", att_name, exc)
                errors.append(f"Triage error for '{att_name}': {exc}")
                run_log.add(**row, status="error", error=str(exc),
                            duration_s=round(time.time() - started, 1))

            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)

    logger.info("Triage complete: %d results, %d errors. Table: %s",
                len(triage_results), len(errors), run_log.path)
    return triage_results, errors


# ── Workflow Orchestrator ────────────────────────────────────────────────────


def run_workflow(
    top: int = 1,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Run the complete Email → Triage workflow.

    Workflow:

        Microsoft Graph
              │
              ▼
        Email Intake Agent
              │
              ▼
        Triage Agent
              │
              ├── SAP AI Core
              │     └── Document Classification
              │
              ├── SAP Document AI
              │     └── Detailed Extraction
              │
              └── Triage Business Logic
                    └── Routing / Review / Classification

    Args:
        top:
            Maximum number of emails to fetch.

        dry_run:
            If True, emails are fetched but triage is skipped.

    Returns:
        Summary containing email counts, triage results, and errors.
    """

    logger.info("=" * 60)
    logger.info("STARTING EMAIL-TO-TRIAGE WORKFLOW")
    logger.info("=" * 60)

    # =============================================================
    # STEP 1 — EMAIL INTAKE
    # =============================================================

    logger.info("STEP 1: Email Intake Agent")

    intake_result = run_intake(top=top)

    if intake_result.get("error"):
        return {
            "error": intake_result["error"],
            "triage_results": [],
            "errors": [
                intake_result["error"]
            ],
        }

    emails = intake_result["emails"]

    if not emails:

        logger.warning(
            "No emails fetched — nothing to triage"
        )

        return {
            "total_emails_fetched": intake_result[
                "total_emails"
            ],
            "triage_results_count": 0,
            "triage_results": [],
            "errors": intake_result.get(
                "errors",
                [],
            ),
            "dry_run": dry_run,
        }

    # =============================================================
    # STEP 2 — TRIAGE AGENT
    # =============================================================
    #
    # AI Core classification happens FIRST inside triage_documents().
    # Document AI extraction happens AFTER classification.
    # =============================================================

    logger.info(
        "STEP 2: Triage Agent"
    )

    triage_results, triage_errors = triage_documents(
        emails,
        dry_run=dry_run,
    )

    # =============================================================
    # FINAL WORKFLOW RESULT
    # =============================================================

    return {
        "total_emails_fetched": intake_result[
            "total_emails"
        ],
        "triage_results_count": len(
            triage_results
        ),
        "triage_results": triage_results,
        "errors": (
            intake_result.get("errors", [])
            + triage_errors
        ),
        "dry_run": dry_run,
    }


# ── Standalone Workflow ──────────────────────────────────────────────────────


def run_workflow_standalone(
    emails: list[EmailMessage],
    dry_run: bool = False,
) -> dict[str, Any]:
    """Run the workflow on pre-supplied EmailMessage objects.

    This bypasses Microsoft Graph and is useful for:
        - Local development
        - Testing
        - Offline pipelines
        - Mock email data
    """

    logger.info("=" * 60)
    logger.info(
        "STARTING EMAIL-TO-TRIAGE WORKFLOW "
        "(STANDALONE MODE)"
    )
    logger.info("=" * 60)

    if not emails:
        return {
            "total_emails_fetched": 0,
            "triage_results_count": 0,
            "triage_results": [],
            "errors": [],
            "dry_run": dry_run,
        }

    triage_results, triage_errors = triage_documents(
        emails,
        dry_run=dry_run,
    )

    return {
        "total_emails_fetched": len(emails),
        "triage_results_count": len(triage_results),
        "triage_results": triage_results,
        "errors": triage_errors,
        "dry_run": dry_run,
    }


# ── CLI Entry Point ──────────────────────────────────────────────────────────


def main() -> None:
    """CLI entry point for the workflow."""

    import argparse

    setup_logging()

    parser = argparse.ArgumentParser(
        description=(
            "Email-to-Triage Workflow: "
            "Email Intake → AI Core → Document AI → Triage"
        ),
    )

    parser.add_argument(
        "--top",
        type=int,
        default=1,
        help=(
            "Max emails to fetch "
            "(default: 1 = latest only)"
        ),
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help=(
            "Fetch emails only, "
            "skip triage"
        ),
    )

    parser.add_argument(
        "--download-only",
        action="store_true",
        help=(
            "Fetch emails and save their attachments to output/attachments/. "
            "No AI Core, no Document AI."
        ),
    )

    args = parser.parse_args()

    if args.download_only:
        intake = run_intake(top=args.top)
        if intake.get("error"):
            print(f"ERROR: {intake['error']}")
            return
        saved = download_attachments(intake["emails"])
        print(f"\nDownloaded {len(saved)} attachment(s) from {len(intake['emails'])} email(s):")
        for p in saved:
            print(f"  {p}")
        return

    summary = run_workflow(
        top=args.top,
        dry_run=args.dry_run,
    )

    print("\n" + "=" * 60)
    print("WORKFLOW SUMMARY")
    print("=" * 60)

    print(
        json.dumps(
            summary,
            indent=2,
            default=str,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()