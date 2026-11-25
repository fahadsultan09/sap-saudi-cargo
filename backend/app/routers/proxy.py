from __future__ import annotations

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from ..clients.agentic_api import AgenticAPI
from ..error_messages import translate
from ..errors import error_response

logger = logging.getLogger(__name__)
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


@router.api_route("/api/v1/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def forward(
    path: str,
    request: Request,
    api: Annotated[AgenticAPI, Depends(agentic_api_dependency)],
) -> Response:
    """Route every /api/v1 call to the agentic API and return its response.

    Successful responses are returned as is; errors are replaced by a business-friendly message.
    """
    headers = {
        name.lower(): value
        for name, value in request.headers.items()
        if name.lower() in FORWARDED_HEADERS
    }
    if "x-user-id" not in headers:
        headers["x-user-id"] = "faizan"
    if "x-user-role" not in headers:
        headers["x-user-role"] = "AP_APPROVER"

    target_path = f"/api/v1/{path}"
    body_bytes = await request.body()

    # Route decision adapter: /cases/{id}/decision -> /cases/{id}/{action}
    if "/decision" in path and request.method == "POST":
        try:
            body_json = json.loads(body_bytes.decode() or "{}")
            action = str(body_json.get("action", "approve")).strip().lower()
            comment = str(body_json.get("comment", "")).strip() or f"{action.capitalize()}d via AP Console"
            parts = path.split("/")
            case_id = parts[1] if len(parts) > 1 else ""
            if case_id:
                target_path = f"/api/v1/cases/{case_id}/{action}"
                body_bytes = json.dumps({"comment": comment}).encode()
                headers["x-user-role"] = "AP_APPROVER"
                headers["content-type"] = "application/json"
        except Exception as e:
            logger.warning("Error transforming /decision call: %s", e)

    # Ensure role compatibility for specialized actions
    if any(path.endswith(f"/{act}") for act in ("approve", "return", "reject")):
        headers["x-user-role"] = "AP_APPROVER"
    elif path.endswith("/fields") and request.method == "PATCH":
        headers["x-user-role"] = "AP_PROCESSOR"
    elif path.endswith("/upload") and request.method == "POST":
        headers["x-user-role"] = "AP_PROCESSOR"

    upstream = await api.forward(
        request.method, target_path, request.url.query, headers, body_bytes
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
