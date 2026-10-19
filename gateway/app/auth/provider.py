"""The identity adapter contract, implemented by every login provider (Keycloak, SAP IAS, ...)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Principal:
    """The signed-in user, with roles already mapped to the app's own role names."""

    user_id: str
    name: str
    email: str | None
    roles: tuple[str, ...]


@dataclass(frozen=True)
class TokenSet:
    access_token: str
    expires_at: float
    refresh_token: str | None = None
    id_token: str | None = None


@dataclass(frozen=True)
class LoginRequest:
    """One login attempt's secrets, kept server-side between the redirect and the callback."""

    state: str
    nonce: str
    code_verifier: str
    return_to: str


class IdentityProvider(Protocol):
    async def authorization_url(self, request: LoginRequest, redirect_uri: str) -> str: ...

    async def exchange_code(
        self, code: str, request: LoginRequest, redirect_uri: str
    ) -> TokenSet: ...

    async def refresh(self, refresh_token: str) -> TokenSet: ...

    async def principal(self, tokens: TokenSet) -> Principal: ...

    async def logout_url(self, tokens: TokenSet, post_logout_redirect_uri: str) -> str | None: ...
