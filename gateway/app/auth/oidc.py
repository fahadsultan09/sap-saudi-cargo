"""Generic OpenID Connect adapter: works with any standard provider via its discovery document."""

from __future__ import annotations

import base64
import hashlib
import time
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt

from ..client_profile.profile import IdentityConfig
from ..core.errors import IdentityUnavailable, NotSignedIn
from .provider import LoginRequest, Principal, TokenSet


def code_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def claim_at(claims: dict[str, Any], dotted_path: str) -> Any:
    value: Any = claims
    for part in dotted_path.split("."):
        value = value.get(part) if isinstance(value, dict) else None
    return value


class OIDCProvider:
    def __init__(self, config: IdentityConfig, client_secret: str, http: httpx.AsyncClient) -> None:
        self.config = config
        self.client_secret = client_secret
        self.http = http
        self._metadata: dict[str, Any] | None = None
        self._keys: jwt.PyJWKSet | None = None

    # ------------------------------------------------------------------ provider documents

    async def _get_json(self, url: str) -> dict[str, Any]:
        try:
            response = await self.http.get(url)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise IdentityUnavailable(
                "The sign-in service is not available right now. Please try again in a few minutes."
            ) from exc
        return response.json()

    async def metadata(self) -> dict[str, Any]:
        if self._metadata is None:
            issuer = self.config.issuer.rstrip("/")
            self._metadata = await self._get_json(f"{issuer}/.well-known/openid-configuration")
        return self._metadata

    async def _signing_key(self, token: str) -> Any:
        kid = jwt.get_unverified_header(token).get("kid")
        for attempt in range(2):
            if self._keys is None or attempt:
                self._keys = jwt.PyJWKSet.from_dict(
                    await self._get_json((await self.metadata())["jwks_uri"])
                )
            for key in self._keys.keys:
                if key.key_id == kid:
                    return key.key
        raise NotSignedIn("Your sign-in could not be confirmed. Please sign in again.")

    async def verify(self, token: str, audience: str) -> dict[str, Any]:
        try:
            return jwt.decode(
                token,
                await self._signing_key(token),
                algorithms=["RS256"],
                audience=audience,
                issuer=(await self.metadata())["issuer"],
            )
        except jwt.PyJWTError as exc:
            raise NotSignedIn("Your sign-in could not be confirmed. Please sign in again.") from exc

    # ------------------------------------------------------------------ login flow

    async def authorization_url(self, request: LoginRequest, redirect_uri: str) -> str:
        query = urlencode({
            "response_type": "code",
            "client_id": self.config.client_id,
            "redirect_uri": redirect_uri,
            "scope": " ".join(self.config.scopes),
            "state": request.state,
            "nonce": request.nonce,
            "code_challenge": code_challenge(request.code_verifier),
            "code_challenge_method": "S256",
        })
        return f"{(await self.metadata())['authorization_endpoint']}?{query}"

    async def _token_request(self, form: dict[str, str]) -> TokenSet:
        try:
            response = await self.http.post(
                (await self.metadata())["token_endpoint"],
                data=form,
                auth=(self.config.client_id, self.client_secret),
            )
        except httpx.HTTPError as exc:
            raise IdentityUnavailable(
                "The sign-in service is not available right now. Please try again in a few minutes."
            ) from exc
        if response.is_error:
            raise NotSignedIn("Your sign-in could not be completed. Please sign in again.")
        body = response.json()
        return TokenSet(
            access_token=body["access_token"],
            expires_at=time.time() + float(body.get("expires_in", 300)),
            refresh_token=body.get("refresh_token"),
            id_token=body.get("id_token"),
        )

    async def exchange_code(self, code: str, request: LoginRequest, redirect_uri: str) -> TokenSet:
        tokens = await self._token_request({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": request.code_verifier,
        })
        # The ID token must answer this login attempt, or the response was replayed.
        id_claims = await self.verify(tokens.id_token or "", self.config.client_id)
        if id_claims.get("nonce") != request.nonce:
            raise NotSignedIn("Your sign-in could not be completed. Please sign in again.")
        return tokens

    async def refresh(self, refresh_token: str) -> TokenSet:
        tokens = await self._token_request(
            {"grant_type": "refresh_token", "refresh_token": refresh_token}
        )
        # Some providers only send a new refresh token occasionally; keep the current one then.
        if tokens.refresh_token is None:
            tokens = TokenSet(
                tokens.access_token, tokens.expires_at, refresh_token, tokens.id_token
            )
        return tokens

    async def principal(self, tokens: TokenSet) -> Principal:
        claims = await self.verify(tokens.access_token, self.config.client_id)
        provider_roles = claim_at(claims, self.config.roles_claim) or []
        role_map = self.config.role_map
        roles = tuple(dict.fromkeys(role_map[role] for role in provider_roles if role in role_map))
        return Principal(
            user_id=str(claims.get("preferred_username") or claims["sub"]),
            name=str(claims.get("name") or claims.get("preferred_username") or claims["sub"]),
            email=claims.get("email"),
            roles=roles,
        )

    async def logout_url(self, tokens: TokenSet, post_logout_redirect_uri: str) -> str | None:
        endpoint = (await self.metadata()).get("end_session_endpoint")
        if not endpoint:
            return None
        query = {"post_logout_redirect_uri": post_logout_redirect_uri}
        if tokens.id_token:
            query["id_token_hint"] = tokens.id_token
        return f"{endpoint}?{urlencode(query)}"
