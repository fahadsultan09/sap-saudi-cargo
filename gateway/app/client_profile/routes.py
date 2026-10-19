from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

from ..config import get_settings
from ..core.errors import AppError

router = APIRouter(tags=["client profile"])


class AssetNotFound(AppError):
    status_code = 404
    code = "not_found"


@router.get("/config/client")
async def client_config(request: Request) -> dict[str, object]:
    """Branding, country and role labels for the frontend; public, so it can show before login."""
    return request.app.state.profile.public()


@router.get("/client-assets/{name}")
async def client_asset(name: str) -> FileResponse:
    folder = get_settings().client_profile.resolve()
    path = (folder / name).resolve()
    # Only files directly in the profile folder, and never the identity configuration.
    if path.parent != folder or not path.is_file() or path.suffix not in {".png", ".svg", ".jpg"}:
        raise AssetNotFound("The requested item could not be found.")
    return FileResponse(path)
