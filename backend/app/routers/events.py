from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import StreamingResponse

from ..config import Settings
from ..dependencies import (
    actor_dependency,
    case_service_dependency,
    settings_dependency,
)
from ..schemas import AuditEvent
from ..services.case_service import CaseService

router = APIRouter(prefix="/api/v1", tags=["events"])
Service = Annotated[CaseService, Depends(case_service_dependency)]


@router.get(
    "/events",
    response_model=list[AuditEvent],
    status_code=200,
    dependencies=[Depends(actor_dependency)],
)
async def get_events(
    service: Service,
    case_id: str | None = None,
    after_id: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
) -> list[AuditEvent]:
    return await service.events(case_id, after_id, limit)


async def event_stream(
    request: Request,
    service: CaseService,
    settings: Settings,
    case_id: str | None,
    cursor: int,
    initial: list[AuditEvent],
) -> AsyncIterator[str]:
    pending = initial
    heartbeat_at = time.monotonic()
    while not await request.is_disconnected():
        for event in pending:
            cursor = event.id
            yield (
                f"id: {event.id}\nevent: case_updated\n"
                f"data: {event.model_dump_json()}\n\n"
            )
        if time.monotonic() - heartbeat_at >= settings.sse_heartbeat_seconds:
            yield ": heartbeat\n\n"
            heartbeat_at = time.monotonic()
        await asyncio.sleep(settings.sse_poll_interval)
        pending = await service.events(case_id, cursor, 100)


@router.get(
    "/stream",
    response_model=None,
    response_class=StreamingResponse,
    status_code=200,
    responses={
        200: {
            "description": "SSE case_updated events; data is an AuditEvent JSON object",
            "content": {"text/event-stream": {"schema": {"type": "string"}}},
        }
    },
    dependencies=[Depends(actor_dependency)],
)
async def stream_events(
    request: Request,
    service: Service,
    settings: Annotated[Settings, Depends(settings_dependency)],
    case_id: str | None = None,
    after_id: Annotated[int, Query(ge=0)] = 0,
    last_event_id: Annotated[int | None, Header(alias="Last-Event-ID", ge=0)] = None,
) -> StreamingResponse:
    cursor = last_event_id if last_event_id is not None else after_id
    initial = await service.events(case_id, cursor, 100)
    return StreamingResponse(
        event_stream(request, service, settings, case_id, cursor, initial),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
