from __future__ import annotations

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from ..auth.dependencies import current_session
from ..auth.sessions import Session
from ..config import get_settings
from ..core.error_messages import translate
from ..core.errors import NotPermitted, error_response
from .agentic_api import AgenticAPI

logger = logging.getLogger(__name__)
router = APIRouter(tags=["proxy"])

# Content and tracing headers pass through; identity comes only from the session, never the browser.
FORWARDED_HEADERS = {"content-type", "idempotency-key", "x-correlation-id"}
RETURNED_HEADERS = {"content-disposition", "content-type"}


def agentic_api_dependency(request: Request) -> AgenticAPI:
    return request.app.state.agentic_api


def identity_headers(request: Request, session: Session) -> dict[str, str]:
    """The signed-in user for the agentic API: the access token, plus (while that API is still in
    development auth mode) the user and role taken from the verified token."""
    headers = {"authorization": f"Bearer {session.tokens.access_token}"}
    if get_settings().forward_identity_headers:
        user = session.principal
        role = request.app.state.profile.primary_role(user.roles)
        headers.update({"x-user-id": user.user_id, "x-user-role": role or ""})
        if user.email:
            headers["x-user-email"] = user.email
    return headers


@router.api_route("/api/v1/{path:path}", methods=["GET", "POST", "PATCH"])
async def forward(
    path: str,
    request: Request,
    api: Annotated[AgenticAPI, Depends(agentic_api_dependency)],
    session: Annotated[Session, Depends(current_session)],
) -> Response:
    """Route every /api/v1 call to the agentic API on behalf of the signed-in user.

    The user's roles must allow the route (access-rules.json); successful responses are returned as
    is and errors are replaced by a business-friendly message.
    """
    user = session.principal
    if not request.app.state.access.allows(request.method, f"/api/v1/{path}", user.roles):
        logger.info(
            "Refused %s /api/v1/%s for %s with roles %s",
            request.method, path, user.user_id, user.roles,
        )
        raise NotPermitted("Your role does not allow this action.")
    headers = {
        name: value
        for name, value in request.headers.items()
        if name.lower() in FORWARDED_HEADERS
    }
    headers.update(identity_headers(request, session))
    upstream = await api.forward(
        request.method, f"/api/v1/{path}", request.url.query, headers, await request.body()
    )
    if upstream.is_error:
        logger.warning(
            "Agentic API error %s on %s /api/v1/%s: %s",
            upstream.status_code, request.method, path, upstream.text[:1000],
        )
        try:
            body = upstream.json()
        except json.JSONDecodeError:
            body = None
        friendly = translate(upstream.status_code, body)
        return error_response(upstream.status_code, friendly.code, friendly.message)
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers={
            name: value
            for name, value in upstream.headers.items()
            if name.lower() in RETURNED_HEADERS
        },
    )
