from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, Header, Request

from .clients.agent_runtime import AgentRuntime
from .clients.document_ai import DocumentAI
from .clients.sap import SAPClient
from .config import Settings
from . import tool_tokens
from .errors import AuthenticationFailure, ConfigurationFailure, ToolTokenInvalid
from .repository import Repository
from .rules import RuleSet
from .schemas import ToolClaims
from .services.agent_service import AgentService
from .services.case_service import CaseService
from .services.dispatch_service import DispatchService
from .services.tool_service import ToolService


def settings_dependency(request: Request) -> Settings:
    return request.app.state.settings


def repository_dependency(request: Request) -> Repository:
    return request.app.state.repository


def document_dependency(request: Request) -> DocumentAI:
    return request.app.state.document_ai


def agent_runtime_dependency(request: Request) -> AgentRuntime:
    return request.app.state.agent_runtime


def sap_dependency(request: Request) -> SAPClient:
    return request.app.state.sap


def rules_dependency(request: Request) -> RuleSet:
    return request.app.state.rules


def actor_dependency(
    settings: Annotated[Settings, Depends(settings_dependency)],
    user: Annotated[
        str | None, Header(alias="X-User-ID", min_length=1, max_length=200)
    ] = None,
    proxy_token: Annotated[str | None, Header(alias="X-Proxy-Token")] = None,
) -> str:
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


def tool_claims_dependency(
    settings: Annotated[Settings, Depends(settings_dependency)],
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> ToolClaims:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise ToolTokenInvalid("A Bearer tool token is required")
    return tool_tokens.verify(settings, token.strip())


def agent_service_dependency(
    runtime: Annotated[AgentRuntime, Depends(agent_runtime_dependency)],
    settings: Annotated[Settings, Depends(settings_dependency)],
    rules: Annotated[RuleSet, Depends(rules_dependency)],
) -> AgentService:
    return AgentService(runtime, settings, rules)


def case_service_dependency(
    repository: Annotated[Repository, Depends(repository_dependency)],
    document_ai: Annotated[DocumentAI, Depends(document_dependency)],
    agent: Annotated[AgentService, Depends(agent_service_dependency)],
    settings: Annotated[Settings, Depends(settings_dependency)],
) -> CaseService:
    return CaseService(repository, document_ai, agent, settings)


def tool_service_dependency(
    repository: Annotated[Repository, Depends(repository_dependency)],
    sap: Annotated[SAPClient, Depends(sap_dependency)],
) -> ToolService:
    return ToolService(repository, sap)


def dispatch_service_dependency(
    cases: Annotated[CaseService, Depends(case_service_dependency)],
    sap: Annotated[SAPClient, Depends(sap_dependency)],
    settings: Annotated[Settings, Depends(settings_dependency)],
) -> DispatchService:
    return DispatchService(cases, sap, settings)
