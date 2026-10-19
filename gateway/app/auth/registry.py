"""Picks the identity adapter named in the client profile; a new provider = a class + one entry."""

from __future__ import annotations

import httpx

from ..client_profile.profile import IdentityConfig
from .oidc import OIDCProvider
from .provider import IdentityProvider

PROVIDERS = {"oidc": OIDCProvider}


def create_provider(
    config: IdentityConfig, client_secret: str, http: httpx.AsyncClient
) -> IdentityProvider:
    try:
        provider_class = PROVIDERS[config.provider]
    except KeyError:
        raise ValueError(
            f"Unknown identity provider '{config.provider}'; choose one of {sorted(PROVIDERS)}"
        ) from None
    return provider_class(config, client_secret, http)
