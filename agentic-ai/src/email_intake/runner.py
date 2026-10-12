"""Email Intake Agent runner -- orchestrates fetch + enrich.

The Email Intake Agent fetches the latest email from Microsoft Graph and
enriches it with full body content + attachments. It does NOT classify
emails -- classification is handled by the Triage Agent using SAP AI Core.

The runner can operate in two modes:
  1. Live mode -- fetches the latest email from Microsoft Graph (requires
     httpx and valid GRAPH_USER_ID / GRAPH_API_TOKEN env vars).
  2. Standalone mode -- accepts pre-constructed EmailMessage objects
     for testing without any API calls.
"""

from __future__ import annotations

import base64
import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Optional

from .fetch import EmailMessage, enrich_emails, fetch_emails

logger = logging.getLogger("email_intake_agent")


# -- Attachment Helper -------------------------------------------------------


def save_attachment_to_temp(attachment: dict[str, Any]) -> Optional[str]:
    """Save a Graph API attachment (base64) to a temp file and return the path."""
    att_name = attachment.get("name", "attachment")
    content_bytes = attachment.get("contentBytes", "")

    if not content_bytes:
        logger.warning("Attachment '%s' has no contentBytes", att_name)
        return None

    try:
        decoded = base64.b64decode(content_bytes)
    except Exception as exc:
        logger.warning("Could not decode attachment '%s': %s", att_name, exc)
        return None

    suffix = Path(att_name).suffix or ".pdf"
    fd, temp_path = tempfile.mkstemp(suffix=suffix, prefix="triage_")
    with os.fdopen(fd, "wb") as f:
        f.write(decoded)

    logger.info("Saved attachment '%s' to temp file: %s (%d bytes)", att_name, temp_path, len(decoded))
    return temp_path


# -- Orchestrator ------------------------------------------------------------


def run_intake(
    top: int = 1,
) -> dict[str, Any]:
    """Run intake: fetch the latest email and enrich it.

    Fetches the most recent email(s) from Microsoft Graph, enriches each
    with full body content + attachment metadata, and returns them ready
    for the Triage Agent. No classification is done here.

    Credentials are read from env vars GRAPH_USER_ID and GRAPH_API_TOKEN
    (or a .env file via python-dotenv) at call time.

    Returns dict with total_emails, emails (list of enriched EmailMessage),
    and any errors.
    """
    from .config import get_credentials

    try:
        user_id, api_token = get_credentials()
    except Exception as exc:
        logger.error("Could not get a Graph access token: %s", exc)
        return {"error": f"Graph authentication failed: {exc}", "total_emails": 0, "emails": []}
    if not user_id or not api_token:
        return {
            "error": "Missing GRAPH_USER_ID, or neither GRAPH_TENANT_ID/GRAPH_CLIENT_ID/GRAPH_CLIENT_SECRET nor GRAPH_API_TOKEN is set",
            "total_emails": 0,
            "emails": [],
        }

    logger.info("=" * 60)
    logger.info("STARTING EMAIL INTAKE AGENT")
    logger.info("=" * 60)

    emails = fetch_emails(user_id, api_token, top=top)
    if not emails:
        logger.warning("No emails fetched")
        return {"total_emails": 0, "emails": [], "errors": ["No emails fetched"]}

    emails = enrich_emails(emails, user_id, api_token)

    logger.info("Intake complete: %d email(s) enriched and ready for triage", len(emails))
    return {"total_emails": len(emails), "emails": emails, "errors": []}


def run_intake_standalone(
    emails: list[EmailMessage],
) -> dict[str, Any]:
    """Return pre-supplied EmailMessage objects ready for triage.

    No Graph API calls -- useful for testing and offline workflows.
    """
    logger.info("=" * 60)
    logger.info("STARTING EMAIL INTAKE (STANDALONE MODE)")
    logger.info("=" * 60)

    logger.info("%d email(s) ready for triage", len(emails))
    return {"total_emails": len(emails), "emails": emails, "errors": []}


# -- CLI Entry Point ---------------------------------------------------------


def main() -> None:
    """CLI entry point -- fetch and enrich the latest email (no triage)."""
    import argparse
    import json

    parser = argparse.ArgumentParser(
        description="Email Intake Agent: fetch and enrich the latest email from Microsoft Graph.",
    )
    parser.add_argument("--top", type=int, default=1, help="Max emails to fetch (default: 1 = latest only)")
    args = parser.parse_args()

    result = run_intake(top=args.top)

    print("\n" + "=" * 60)
    print("EMAIL INTAKE RESULTS")
    print("=" * 60)
    print(json.dumps({
        "total_emails": result["total_emails"],
        "emails": len(result["emails"]),
        "errors": result.get("errors", []),
    }, indent=2))

    for email in result["emails"]:
        print(f"  subject='{email.subject[:50]}'  from={email.sender}  received={email.received_date}  attachments={len(email.attachments)}")
