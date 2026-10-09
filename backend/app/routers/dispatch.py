from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from ..dependencies import dispatch_service_dependency, internal_actor_dependency
from ..schemas import Case, PostRequest
from ..services.dispatch_service import DispatchService

router = APIRouter(prefix="/internal/v1/dispatch", tags=["dispatch"])
Service = Annotated[DispatchService, Depends(dispatch_service_dependency)]
Actor = Annotated[str, Depends(internal_actor_dependency)]


@router.post("/{id}/post", response_model=Case, status_code=200)
async def post_case(
    id: str, request: PostRequest, service: Service, actor: Actor
) -> Case:
    return await service.post(id, request, actor)


@router.post("/{id}/reconcile", response_model=Case, status_code=200)
async def reconcile_case(id: str, service: Service, actor: Actor) -> Case:
    return await service.reconcile(id, actor)


@router.post("/{id}/resolve", response_model=Case, status_code=200)
async def resolve_case(id: str, service: Service, actor: Actor) -> Case:
    return await service.resolve(id, actor)
