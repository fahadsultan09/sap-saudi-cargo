from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .clients.agentic_api import AgenticAPI
from .config import get_settings
from .errors import register_handlers
from .routers import proxy
from .schemas import ErrorResponse, Health


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=settings.http_timeout) as http:
        application.state.agentic_api = AgenticAPI(http, settings)
        yield


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title="Saudi Cargo AP Gateway",
        description="Routes the AP Console's /api/v1 calls to the agentic API.",
        version="2.0.0",
        lifespan=lifespan,
        responses={502: {"model": ErrorResponse}},
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["*"],
    )
    register_handlers(application)
    application.include_router(proxy.router)
    return application


app = create_app()


@app.get("/health", response_model=Health, status_code=200, tags=["health"])
async def health(request: Request) -> Health:
    reachable = await request.app.state.agentic_api.reachable()
    return Health(agentic_api="reachable" if reachable else "unreachable")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=get_settings().port)
