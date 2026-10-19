"""Server-side sessions, as SAP's App Router keeps them: the browser only holds a session id."""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from typing import Protocol

from .provider import LoginRequest, Principal, TokenSet

LOGIN_REQUEST_TTL_SECONDS = 600


@dataclass
class Session:
    id: str
    tokens: TokenSet
    principal: Principal


class SessionStore(Protocol):
    def create(self, tokens: TokenSet, principal: Principal) -> Session: ...

    def get(self, session_id: str) -> Session | None: ...

    def delete(self, session_id: str) -> Session | None: ...

    def save_login(self, request: LoginRequest) -> None: ...

    def take_login(self, state: str) -> LoginRequest | None: ...


class MemorySessionStore:
    """Sessions in process memory: fine for one gateway instance; a restart signs everyone out.

    Several instances behind a load balancer need a shared store (e.g. Redis) with the same methods.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._logins: dict[str, tuple[float, LoginRequest]] = {}

    def create(self, tokens: TokenSet, principal: Principal) -> Session:
        session = Session(secrets.token_urlsafe(32), tokens, principal)
        self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    def delete(self, session_id: str) -> Session | None:
        return self._sessions.pop(session_id, None)

    def save_login(self, request: LoginRequest) -> None:
        now = time.time()
        self._logins = {
            state: entry for state, entry in self._logins.items() if entry[0] > now
        }
        self._logins[request.state] = (now + LOGIN_REQUEST_TTL_SECONDS, request)

    def take_login(self, state: str) -> LoginRequest | None:
        entry = self._logins.pop(state, None)
        return entry[1] if entry and entry[0] > time.time() else None
