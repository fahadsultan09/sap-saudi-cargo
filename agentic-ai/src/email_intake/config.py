"""Configuration for the Email Intake Agent.

Only Graph API configuration is needed for fetch + enrich.
Scoring/classification is handled by the Triage Agent via SAP AI Core.
"""

from __future__ import annotations

import os
from pathlib import Path

# -- Graph API Configuration -------------------------------------------------

# Project root (parent of src/email_intake) — where a .env file may live.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _load_env_file() -> None:
    """Load a .env file (project root or config/) if python-dotenv is installed.

    Values already present in the environment are NOT overridden, so real
    exported env vars always win over .env contents.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for env_path in (_PROJECT_ROOT / ".env", _PROJECT_ROOT / "config" / ".env"):
        if env_path.is_file():
            load_dotenv(env_path, override=False)


_load_env_file()

GRAPH_API_BASE_URL = os.getenv("GRAPH_API_BASE_URL", "https://graph.microsoft.com")


def _acquire_token_client_credentials(
    tenant_id: str, client_id: str, client_secret: str
) -> str:
    """Acquire a Graph access token via the OAuth2 client credentials flow.

    Uses the app registration's tenant_id + client_id + client_secret to
    request an app-only token from login.microsoftonline.com. Requires the
    'Mail.Read' application permission (with admin consent) on the app
    registration in Azure.

    Raises on any failure so the caller sees the exact OAuth error.
    """
    import httpx

    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    data = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "https://graph.microsoft.com/.default",
    }
    resp = httpx.post(url, data=data, timeout=30)
    if resp.status_code != 200:
        detail = resp.text[:300]
        raise RuntimeError(
            f"OAuth2 token request failed (HTTP {resp.status_code}): {detail}"
        )
    return resp.json()["access_token"]


def get_credentials() -> tuple[str, str]:
    """Read credentials from env vars at call time (not import time).

    A .env file at the project root or in config/ is loaded first (if
    python-dotenv is installed), so credentials can be supplied via .env
    instead of exported shell variables.

    Token resolution order:
      1. OAuth2 client credentials flow using GRAPH_TENANT_ID /
         GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET (app registration)
      2. GRAPH_API_TOKEN (a pre-acquired access token), if those are not set

    GRAPH_USER_ID is the mailbox to read (e.g. sacc.ap.invoice@addo.ai).
    """
    _load_env_file()
    user_id = os.getenv("GRAPH_USER_ID", "")
    tenant_id = os.getenv("GRAPH_TENANT_ID", "")
    client_id = os.getenv("GRAPH_CLIENT_ID", "")
    client_secret = os.getenv("GRAPH_CLIENT_SECRET", "")

    # Client credentials win when fully configured: a leftover/placeholder
    # GRAPH_API_TOKEN would otherwise shadow them and cause a 401.
    if tenant_id and client_id and client_secret:
        token = _acquire_token_client_credentials(tenant_id, client_id, client_secret)
    else:
        token = os.getenv("GRAPH_API_TOKEN", "")

    return user_id, token


# -- Document extensions (for attachment filtering) -------------------------

DOCUMENT_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff",
    ".doc", ".docx", ".xls", ".xlsx",
}
