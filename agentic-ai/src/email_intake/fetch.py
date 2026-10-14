"""Graph API fetch and enrich functions.

These functions make HTTP calls to the Microsoft Graph API (or a compatible
proxy). They require the ``httpx`` package and valid Graph API credentials.

The Email Intake Agent fetches ONLY the latest email (highest receivedDateTime)
and enriches it with full body + attachments. Classification is handled by
the Triage Agent using SAP AI Core — not here.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

from .config import GRAPH_API_BASE_URL

logger = logging.getLogger("email_intake_agent")

# Local graph_mail_real.py proxy URL — used as a fallback when direct
# Graph API access fails (e.g. token expired, network blocked).
_GRAPH_PROXY_URL = os.getenv("GRAPH_PROXY_URL", "http://localhost:8002")


# -- Graph API helper (direct + proxy fallback) ----------------------------


def _graph_get(
    path: str,
    *,
    api_token: str,
    params: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """GET from Microsoft Graph with automatic fallback to the local proxy.

    Tries the direct Graph API (Bearer header) first.  If that fails,
    falls back to the local graph_mail_real.py proxy (api_token query
    parameter) which handles MSAL authentication internally.
    """
    try:
        import httpx
    except ImportError:
        logger.error("httpx not installed — cannot make Graph API request")
        return None

    # ── Direct attempt (Bearer header) ──
    direct_url = f"{GRAPH_API_BASE_URL}/v1.0/{path.lstrip('/')}"
    direct_headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {api_token}",
    }
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(direct_url, headers=direct_headers, params=params)
            logger.info("Direct Graph request: %s", direct_url)
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        logger.error("Direct Graph API error: %s", exc)

    # ── Fallback: local proxy (api_token query param) ──
    logger.warning("Falling back to local proxy at %s …", _GRAPH_PROXY_URL)
    proxy_url = f"{_GRAPH_PROXY_URL}/v1.0/{path.lstrip('/')}"
    proxy_params = {**(params or {}), "api_token": api_token}
    proxy_headers = {"Accept": "application/json"}
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(proxy_url, headers=proxy_headers, params=proxy_params)
            logger.info("Proxy Graph request: %s", proxy_url)  # no api_token in logs
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        logger.error("Proxy fallback also failed: %s", exc)
        return None


# -- Data Model -------------------------------------------------------------


@dataclass
class EmailMessage:
    """Normalised email representation returned by the Email Intake Agent."""
    message_id: str
    subject: str
    sender: str
    sender_name: str = ""
    recipients: list[str] = field(default_factory=list)
    received_date: str = ""
    body_preview: str = ""
    body_content: str = ""
    has_attachments: bool = False
    attachments: list[dict[str, Any]] = field(default_factory=list)
    importance: str = "normal"
    is_read: bool = False


# ── Node 1: Fetch Emails ───────────────────────────────────────────────────


def fetch_emails(user_id: str, api_token: str, top: int = 1) -> list[EmailMessage]:
    """Fetch the latest email(s) from the mailbox.

    Uses $orderby=receivedDateTime desc so the most recent email is first.
    By default fetches only 1 email (the latest). Increase ``top`` to fetch
    more if needed.

    Tries the direct Graph API first (Bearer token).  If that fails, falls
    back to the local graph_mail_real.py proxy (api_token query parameter).
    """
    logger.info("Node 1: Fetching latest email(s) from Graph API for user %s …", user_id)

    params = {
        "$top": top,
        "$orderby": "receivedDateTime desc",
        "$select": "id,subject,from,toRecipients,receivedDateTime,bodyPreview,"
                    "hasAttachments,importance,isRead",
    }

    data = _graph_get(
        f"users/{user_id}/messages",
        api_token=api_token,
        params=params,
    )

    if data is None:
        return []

    messages = data.get("value", [])
    logger.info("Fetched %d messages", len(messages))

    emails: list[EmailMessage] = []
    for msg in messages:
        sender_obj = msg.get("from", {})
        sender_email = sender_obj.get("emailAddress", {}).get("address", "")
        sender_name = sender_obj.get("emailAddress", {}).get("name", "")
        recipients = [
            r.get("emailAddress", {}).get("address", "")
            for r in msg.get("toRecipients", [])
        ]
        emails.append(EmailMessage(
            message_id=msg.get("id", ""),
            subject=msg.get("subject", ""),
            sender=sender_email,
            sender_name=sender_name,
            recipients=recipients,
            received_date=msg.get("receivedDateTime", ""),
            body_preview=msg.get("bodyPreview", ""),
            has_attachments=msg.get("hasAttachments", False),
            importance=msg.get("importance", "normal"),
            is_read=msg.get("isRead", False),
        ))

    return emails


# ── Node 2: Enrich Emails ──────────────────────────────────────────────────


def enrich_emails(emails: list[EmailMessage], user_id: str, api_token: str) -> list[EmailMessage]:
    """Fetch full body content and attachment metadata for each email.

    Tries the direct Graph API first; falls back to the local proxy per
    request if direct access fails.
    """
    logger.info("Node 2: Enriching %d emails with full body and attachments …", len(emails))

    base_path = f"users/{user_id}/messages"

    for email in emails:
        full_msg = _graph_get(
            f"{base_path}/{email.message_id}",
            api_token=api_token,
            params={"$select": "id,subject,body,from,toRecipients"},
        )
        if full_msg is not None:
            body_obj = full_msg.get("body", {})
            email.body_content = body_obj.get("content", "")
        else:
            logger.warning("Could not fetch body for message %s", email.message_id[:20])

        if email.has_attachments:
            att_data = _graph_get(
                f"{base_path}/{email.message_id}/attachments",
                api_token=api_token,
            )
            if att_data is not None:
                email.attachments = att_data.get("value", [])
            else:
                logger.warning("Could not fetch attachments for %s", email.message_id[:20])

    logger.info(
        "Enrichment complete: %d emails with body content, %d with attachments",
        sum(1 for e in emails if e.body_content),
        sum(1 for e in emails if e.attachments),
    )
    return emails
