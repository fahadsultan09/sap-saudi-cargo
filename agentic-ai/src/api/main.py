from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import APP_ENV, AUTH_MODE, UPLOAD_DIR, validate_config
from .database import init_db
from .routers import agents, approvals, cases, health

from src.api.routers.internal_processing import router as internal_processing_router

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("ap_api")

validate_config()


@asynccontextmanager
async def lifespan(application: FastAPI):
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    init_db()
    logger.info("AP workflow API started, env=%s auth_mode=%s", APP_ENV, AUTH_MODE)
    yield


app = FastAPI(
    title="SACC AP Invoice Workflow API",
    version="1.0.0",
    description="Invoice triage, human review, finance approval and audit API.",
    lifespan=lifespan,
)


_origins = [
    x.strip()
    for x in os.getenv(
        "AP_CORS_ORIGINS", "http://localhost:8080,http://localhost:5173"
    ).split(",")
    if x.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-User-Id",
        "X-User-Role",
        "X-User-Email",
        "Idempotency-Key",
    ],
)

app.include_router(health.router)
app.include_router(agents.router)
app.include_router(cases.router)
app.include_router(approvals.router)
app.include_router(internal_processing_router)