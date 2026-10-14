from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from ..clients.agentic_api import AgenticAPI

router = APIRouter(tags=["proxy"])

# Only identity, content and tracing headers reach the agentic API; host and cookies do not.
FORWARDED_HEADERS = {
    "authorization",
    "content-type",
    "idempotency-key",
    "x-correlation-id",
    "x-user-email",
    "x-user-id",
    "x-user-role",
}
RETURNED_HEADERS = {"content-disposition", "content-type"}


def agentic_api_dependency(request: Request) -> AgenticAPI:
    return request.app.state.agentic_api


@router.api_route("/api/v1/{path:path}", methods=["GET", "POST", "PATCH"])
async def forward(
    path: str,
    request: Request,
    api: Annotated[AgenticAPI, Depends(agentic_api_dependency)],
) -> Response:
    """Route every /api/v1 call unchanged to the agentic API and return its response as is."""
    headers = {
        name: value
        for name, value in request.headers.items()
        if name.lower() in FORWARDED_HEADERS
    }
    upstream = await api.forward(
        request.method, f"/api/v1/{path}", request.url.query, headers, await request.body()
    )
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers={
            name: value
            for name, value in upstream.headers.items()
            if name.lower() in RETURNED_HEADERS
        },
    )
