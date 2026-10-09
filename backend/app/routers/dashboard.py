from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from ..dependencies import actor_dependency, case_service_dependency
from ..schemas import Dashboard
from ..services.case_service import CaseService

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


@router.get(
    "",
    response_model=Dashboard,
    status_code=200,
    dependencies=[Depends(actor_dependency)],
)
async def get_dashboard(
    service: Annotated[CaseService, Depends(case_service_dependency)],
) -> Dashboard:
    return await service.dashboard()
