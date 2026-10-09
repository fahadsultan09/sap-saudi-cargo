from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from .clients.ai_core import SAPAICore
from .clients.document_ai import SAPDocumentAI
from .clients.sap import MockSAPClient
from .config import get_settings
from .errors import register_handlers
from .repository import Repository
from .routers import cases, dashboard, dispatch, events
from .rules import load_rules
from .schemas import ErrorResponse, Health

ERROR_RESPONSES = {
    status: {"model": ErrorResponse}
    for status in (401, 403, 404, 409, 413, 415, 422, 500, 502, 503)
}


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    rules = load_rules(settings.rules_path)
    repository = Repository(settings.database_path)
    await asyncio.to_thread(repository.initialize)
    async with httpx.AsyncClient(timeout=settings.http_timeout) as http:
        application.state.settings = settings
        application.state.rules = rules
        application.state.repository = repository
        application.state.document_ai = SAPDocumentAI(http, settings)
        application.state.ai_core = SAPAICore(http, settings)
        application.state.sap = MockSAPClient(repository, settings)
        yield


def create_app() -> FastAPI:
    application = FastAPI(
        title="Saudi Cargo AP Agentic Automation",
        version="1.0.0",
        lifespan=lifespan,
        responses=ERROR_RESPONSES,
    )
    register_handlers(application)
    for router in (cases.router, events.router, dashboard.router, dispatch.router):
        application.include_router(router)
    return application


app = create_app()


@app.get("/health", response_model=Health, status_code=200, tags=["health"])
async def health() -> Health:
    return Health()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=get_settings().port)
