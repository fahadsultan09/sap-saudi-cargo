from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..auth import get_actor
from ..config import AUTH_MODE
from ..schemas import Actor, HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok", service="sacc-ap-workflow-api", auth_mode=AUTH_MODE
    )


@router.get("/api/v1/me")
def me(actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    return {"user_id": actor.user_id, "role": actor.role, "email": actor.email}
