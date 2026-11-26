from __future__ import annotations

import time

from fastapi import Request

from ..config import get_settings
from ..core.errors import NotSignedIn
from .provider import IdentityProvider
from .sessions import Session, SessionStore

# Refresh this long before the access token expires, so a forwarded call never carries a stale one.
REFRESH_MARGIN_SECONDS = 30


def identity_provider(request: Request) -> IdentityProvider:
    return request.app.state.identity


def session_store(request: Request) -> SessionStore:
    return request.app.state.sessions


async def current_session(request: Request) -> Session:
    """The caller's session with a fresh access token; 401 sends the frontend to the login."""
    sessions = session_store(request)
    session = sessions.get(request.cookies.get(get_settings().session_cookie, ""))
    if session is None:
        raise NotSignedIn("Please sign in to continue.")
    if session.tokens.expires_at - time.time() < REFRESH_MARGIN_SECONDS:
        if not session.tokens.refresh_token:
            sessions.delete(session.id)
            raise NotSignedIn("Your session has ended. Please sign in again.")
        provider = identity_provider(request)
        try:
            session.tokens = await provider.refresh(session.tokens.refresh_token)
            session.principal = await provider.principal(session.tokens)
        except NotSignedIn:
            sessions.delete(session.id)
            raise
    return session
