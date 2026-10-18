"""Serves the UI through the gateway, so users open one address (as with SAP's App Router).

Development: requests are forwarded to the UI5 dev server (FRONTEND_URL).
Production: the built webapp folder (FRONTEND_DIR) is served as static files.
"""

from __future__ import annotations

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.staticfiles import StaticFiles

from ..config import Settings
from ..core.errors import UpstreamUnavailable

RETURNED_HEADERS = {"content-type", "cache-control", "etag", "last-modified"}


def mount_frontend(app: FastAPI, settings: Settings) -> None:
    """Registered last: everything the other routes do not handle is the UI."""
    if settings.frontend_dir:
        app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="frontend")
        return
    if not settings.frontend_url:
        return
    base_url = settings.frontend_url.rstrip("/")

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str, request: Request) -> Response:
        url = f"{base_url}/{path}" + (f"?{request.url.query}" if request.url.query else "")
        try:
            # Marks the request as coming through the gateway, so the dev server serves the page
            # instead of redirecting the browser here (frontend/lib/rootIndex.js).
            upstream = await request.app.state.http.get(
                url,
                headers={
                    "x-forwarded-host": request.url.netloc,
                    "x-forwarded-proto": request.url.scheme,
                },
            )
        except httpx.HTTPError as exc:
            raise UpstreamUnavailable(
                "The application screens are not available right now. Please try again shortly."
            ) from exc
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            headers={
                name: value
                for name, value in upstream.headers.items()
                if name.lower() in RETURNED_HEADERS
            },
        )
