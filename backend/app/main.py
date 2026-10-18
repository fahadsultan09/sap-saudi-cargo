from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request

from .auth import routes as auth_routes
from .auth.access import AccessPolicy
from .auth.registry import create_provider
from .auth.sessions import MemorySessionStore
from .client_profile import routes as profile_routes
from .client_profile.profile import load_profile
from .config import get_settings
from .core.errors import register_handlers
from .core.schemas import ErrorResponse, Health
from .gateway import proxy
from .gateway.agentic_api import AgenticAPI
from .gateway.frontend import mount_frontend


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=settings.http_timeout) as http:
        application.state.http = http
        application.state.agentic_api = AgenticAPI(http, settings)
        application.state.identity = create_provider(
            application.state.profile.identity, settings.oidc_client_secret, http
        )
        application.state.sessions = MemorySessionStore()
        yield


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title="AP Automation Gateway",
        description="Single entry point: sign-in, the AP Console UI and its /api/v1 calls.",
        version="3.0.0",
        lifespan=lifespan,
        responses={502: {"model": ErrorResponse}},
    )
    # Loaded at start-up: a broken client profile or rules file stops the gateway, not a later call.
    application.state.profile = load_profile(settings.client_profile)
    application.state.access = AccessPolicy.load(settings.access_rules)
    register_handlers(application)

    @application.get("/health", response_model=Health, tags=["health"])
    async def health(request: Request) -> Health:
        reachable = await request.app.state.agentic_api.reachable()
        return Health(agentic_api="reachable" if reachable else "unreachable")

    application.include_router(auth_routes.router)
    application.include_router(profile_routes.router)
    application.include_router(proxy.router)
    mount_frontend(application, settings)
    return application


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=get_settings().port)
