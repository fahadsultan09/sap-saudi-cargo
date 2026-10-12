"""Email Intake Agent -- standalone email fetch and enrich.

The Email Intake Agent fetches the latest email from Microsoft Graph and
enriches it with full body + attachments. Classification is handled by the
Triage Agent using SAP AI Core, not here.

Public API::

    from email_intake import run_intake, run_intake_standalone
    from email_intake import EmailMessage, save_attachment_to_temp
    from email_intake import fetch_emails, enrich_emails
"""

from .config import DOCUMENT_EXTENSIONS
from .fetch import EmailMessage, enrich_emails, fetch_emails
from .runner import run_intake, run_intake_standalone, save_attachment_to_temp

__all__ = [
    # Models
    "EmailMessage",
    # Config
    "DOCUMENT_EXTENSIONS",
    # Fetch (requires httpx + Graph API)
    "enrich_emails",
    "fetch_emails",
    # Runner
    "run_intake",
    "run_intake_standalone",
    "save_attachment_to_temp",
]

__version__ = "2.0.0"
