"""Demo-friendly auth surface for the thin gateway.

Full Keycloak / OIDC (as on backend-abdulahad's gateway) needs IdP credentials
and a reachable issuer. For local ClearDesk demos this returns a stable profile
from request headers (role switcher) or env defaults so `/auth/me` is real
API-backed rather than FE-only fiction.
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Request

router = APIRouter(prefix="/auth", tags=["auth"])

ROLE_LABELS = {
    "AP_PROCESSOR": "Processor",
    "AP_APPROVER": "Approver",
    "FINANCE_MANAGER": "Finance manager",
    "ADMIN": "Admin",
}


def _profile_from_request(request: Request) -> dict[str, Any]:
    user_id = (
        request.headers.get("x-user-id")
        or os.getenv("GATEWAY_DEMO_USER_ID")
        or "faizan"
    ).strip()
    role = (
        request.headers.get("x-user-role")
        or os.getenv("GATEWAY_DEMO_USER_ROLE")
        or "AP_APPROVER"
    ).strip()
    email = request.headers.get("x-user-email") or os.getenv("GATEWAY_DEMO_USER_EMAIL")
    name = os.getenv("GATEWAY_DEMO_USER_NAME") or user_id.replace(".", " ").title()
    return {
        "userId": user_id,
        "name": name,
        "email": email,
        "roles": [role] if role else [],
        "role": role,
        "roleLabel": ROLE_LABELS.get(role, role),
        "authMode": "demo_session",
        "keycloakConfigured": False,
    }


@router.get("/me")
async def me(request: Request) -> dict[str, Any]:
    """Stable session profile matching the ClearDesk FE contract."""
    return _profile_from_request(request)


@router.get("/logout")
async def logout() -> dict[str, Any]:
    """Demo stub — no Keycloak session to clear locally."""
    return {
        "ok": True,
        "message": "Local demo session cleared. Full Keycloak logout needs IdP credentials.",
    }
