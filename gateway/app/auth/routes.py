"""Login routes, as SAP's App Router does: send users to the identity provider, keep the session."""

from __future__ import annotations

import secrets
import json
from html import escape
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response

from ..config import get_settings
from ..core.errors import NotSignedIn
from .dependencies import current_session, identity_provider, session_store
from .provider import IdentityProvider, LoginRequest
from .sessions import Session, SessionStore

router = APIRouter(prefix="/auth", tags=["auth"])

Provider = Annotated[IdentityProvider, Depends(identity_provider)]
Sessions = Annotated[SessionStore, Depends(session_store)]

SIGN_IN_FAILED_PAGE = (
    "<!doctype html><meta charset='utf-8'><title>Sign-in</title>"
    "<p style='font-family:sans-serif'>Your sign-in could not be completed. "
    "<a href='/auth/login'>Try again</a></p>"
)

AUTH_RESPONSE_HEADERS = {"Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer"}


def finish_sign_in(target: str) -> HTMLResponse:
    """Remove the single-use callback from browser history before entering the app."""
    script_target = json.dumps(target).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return HTMLResponse(
        "<!doctype html><meta charset='utf-8'><title>Signing in</title>"
        f"<script>window.location.replace({script_target});</script>"
        f"<noscript><a href='{escape(target, quote=True)}'>Continue to AP Console</a></noscript>",
        headers=AUTH_RESPONSE_HEADERS,
    )


def callback_url() -> str:
    return f"{get_settings().public_url.rstrip('/')}/auth/callback"


def safe_return_to(value: str) -> str:
    """Only paths inside this app, so the login cannot be used to send users to another site."""
    if value.startswith("#/") or (value.startswith("/") and not value.startswith("//")):
        return value
    return "/"


@router.get("/login")
async def login(provider: Provider, sessions: Sessions, returnTo: str = "/") -> RedirectResponse:
    request = LoginRequest(
        state=secrets.token_urlsafe(24),
        nonce=secrets.token_urlsafe(24),
        code_verifier=secrets.token_urlsafe(64),
        return_to=safe_return_to(returnTo),
    )
    sessions.save_login(request)
    return RedirectResponse(await provider.authorization_url(request, callback_url()), 303, headers=AUTH_RESPONSE_HEADERS)


@router.get("/callback", response_model=None)
async def callback(
    http_request: Request, provider: Provider, sessions: Sessions, state: str = "", code: str = ""
) -> Response:
    request = sessions.take_login(state)
    if request is None:
        # Back/reload can revisit an already-consumed callback. Never exchange its code again.
        # Validate/refresh the current session rather than trusting the presence of a cookie.
        try:
            await current_session(http_request)
        except NotSignedIn:
            return RedirectResponse("/auth/login", 303, headers=AUTH_RESPONSE_HEADERS)
        return finish_sign_in("/#/dashboard")
    if not code:
        return HTMLResponse(SIGN_IN_FAILED_PAGE, status_code=400, headers=AUTH_RESPONSE_HEADERS)
    try:
        tokens = await provider.exchange_code(code, request, callback_url())
        session = sessions.create(tokens, await provider.principal(tokens))
    except NotSignedIn:
        return HTMLResponse(SIGN_IN_FAILED_PAGE, status_code=400, headers=AUTH_RESPONSE_HEADERS)
    target = request.return_to if request.return_to.startswith("/") else f"/{request.return_to}"
    response = finish_sign_in(target)
    settings = get_settings()
    response.set_cookie(
        settings.session_cookie,
        session.id,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )
    return response


@router.get("/logout")
async def logout(http_request: Request, provider: Provider, sessions: Sessions) -> RedirectResponse:
    settings = get_settings()
    session = sessions.delete(http_request.cookies.get(settings.session_cookie, ""))
    target = "/"
    if session is not None:
        home = f"{settings.public_url.rstrip('/')}/"
        target = await provider.logout_url(session.tokens, home) or "/"
    response = RedirectResponse(target, 303)
    response.delete_cookie(settings.session_cookie, path="/")
    return response


@router.get("/me")
async def me(session: Annotated[Session, Depends(current_session)]) -> dict[str, object]:
    user = session.principal
    return {
        "userId": user.user_id,
        "name": user.name,
        "email": user.email,
        "roles": list(user.roles),
    }
