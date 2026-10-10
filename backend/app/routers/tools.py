from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from ..dependencies import tool_claims_dependency, tool_service_dependency
from ..enums import ToolName
from ..schemas import ToolClaims, ToolResponse
from ..services.tool_service import ToolService

router = APIRouter(prefix="/internal/v1/tools", tags=["tools"])
Service = Annotated[ToolService, Depends(tool_service_dependency)]
Claims = Annotated[ToolClaims, Depends(tool_claims_dependency)]


@router.post("/{name}", response_model=ToolResponse, status_code=200)
async def call_tool(
    name: ToolName, args: dict[str, str], service: Service, claims: Claims
) -> ToolResponse:
    return await service.run(name, args, claims)
