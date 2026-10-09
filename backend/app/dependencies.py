from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, Header, Request

from .clients.ai_core import AICore
from .clients.document_ai import DocumentAI
from .clients.sap import SAPClient
from .config import Settings
from .errors import AuthenticationFailure, ConfigurationFailure
from .repository import Repository
from .services.case_service import CaseService
from .services.dispatch_service import DispatchService


def settings_dependency(request: Request) -> Settings:
    return request.app.state.settings


def repository_dependency(request: Request) -> Repository:
    return request.app.state.repository


def document_dependency(request: Request) -> DocumentAI:
    return request.app.state.document_ai


def ai_dependency(request: Request) -> AICore:
    return request.app.state.ai_core


def sap_dependency(request: Request) -> SAPClient:
    return request.app.state.sap


def actor_dependency(
    settings: Annotated[Settings, Depends(settings_dependency)],
    user: Annotated[
        str | None, Header(alias="X-User-ID", min_length=1, max_length=200)
    ] = None,
    proxy_token: Annotated[str | None, Header(alias="X-Proxy-Token")] = None,
) -> str:
    # Require a valid printable human identity header.
    if (
        user is None
        or not user.strip()
        or not user.isascii()
        or any(ord(char) < 32 for char in user)
    ):
        raise AuthenticationFailure("A printable ASCII X-User-ID is required")
    # Authenticate proxy credentials in trusted header mode.
    if settings.auth_mode == "trusted_header":
        expected = settings.trusted_proxy_token.get_secret_value()
        # Refuse access when the required shared secret is absent.
        if not expected:
            raise ConfigurationFailure("Trusted proxy token is not configured")
        # Reject credentials using a constant-time comparison.
        if not proxy_token or not hmac.compare_digest(
            proxy_token.encode(), expected.encode()
        ):
            raise AuthenticationFailure("Invalid trusted proxy credentials")
    return user.strip().casefold()


# Authenticate internal dispatch independently of human identity headers.
def internal_actor_dependency(
    settings: Annotated[Settings, Depends(settings_dependency)],
    token: Annotated[str | None, Header(alias="X-Internal-Token")] = None,
) -> str:
    expected = settings.internal_api_token.get_secret_value()
    # Refuse access when the required shared secret is absent.
    if not expected:
        raise ConfigurationFailure("Internal dispatch token is not configured")
    # Reject credentials using a constant-time comparison.
    if not token or not hmac.compare_digest(token.encode(), expected.encode()):
        raise AuthenticationFailure("Invalid internal dispatch credentials")
    return "internal-dispatch"


def case_service_dependency(
    repository: Annotated[Repository, Depends(repository_dependency)],
    document_ai: Annotated[DocumentAI, Depends(document_dependency)],
    ai_core: Annotated[AICore, Depends(ai_dependency)],
    sap: Annotated[SAPClient, Depends(sap_dependency)],
    settings: Annotated[Settings, Depends(settings_dependency)],
) -> CaseService:
    return CaseService(repository, document_ai, ai_core, sap, settings)


def dispatch_service_dependency(
    cases: Annotated[CaseService, Depends(case_service_dependency)],
    sap: Annotated[SAPClient, Depends(sap_dependency)],
    settings: Annotated[Settings, Depends(settings_dependency)],
) -> DispatchService:
    return DispatchService(cases, sap, settings)
