from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile

from ..dependencies import actor_dependency, case_service_dependency
from ..enums import CaseStatus
from ..schemas import (
    Case,
    CaseList,
    InformRequest,
    Invoice,
    RejectRequest,
    ReviewRequest,
)
from ..services.case_service import CaseService

router = APIRouter(prefix="/api/v1/cases", tags=["cases"])
Service = Annotated[CaseService, Depends(case_service_dependency)]
Actor = Annotated[str, Depends(actor_dependency)]


@router.post("/upload", response_model=Case, status_code=201)
async def upload_case(
    service: Service,
    actor: Actor,
    file: Annotated[UploadFile, File(description="Original PDF invoice")],
) -> Case:
    return await service.upload(file, actor)


@router.post("", response_model=Case, status_code=201)
async def create_case(invoice: Invoice, service: Service, actor: Actor) -> Case:
    return await service.create(invoice, actor)


@router.get(
    "",
    response_model=CaseList,
    status_code=200,
    dependencies=[Depends(actor_dependency)],
)
async def list_cases(
    service: Service,
    status: CaseStatus | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> CaseList:
    return await service.list(status, limit, offset)


@router.get(
    "/{id}",
    response_model=Case,
    status_code=200,
    dependencies=[Depends(actor_dependency)],
)
async def get_case(id: str, service: Service) -> Case:
    return await service.get(id)


@router.post("/{id}/review", response_model=Case, status_code=200)
async def review_case(
    id: str, request: ReviewRequest, service: Service, actor: Actor
) -> Case:
    return await service.review(id, request, actor)


@router.post("/{id}/decide", response_model=Case, status_code=200)
async def decide_case(id: str, service: Service, actor: Actor) -> Case:
    return await service.decide(id, actor)


@router.post("/{id}/confirm", response_model=Case, status_code=200)
async def confirm_case(id: str, service: Service, actor: Actor) -> Case:
    return await service.confirm(id, actor)


@router.post("/{id}/approve", response_model=Case, status_code=200)
async def approve_case(id: str, service: Service, actor: Actor) -> Case:
    return await service.approve(id, actor)


@router.get(
    "/{id}/document",
    response_model=None,
    response_class=Response,
    status_code=200,
    responses={
        200: {
            "description": "Original PDF",
            "content": {
                "application/pdf": {"schema": {"type": "string", "format": "binary"}}
            },
        }
    },
    dependencies=[Depends(actor_dependency)],
)
async def get_document(id: str, service: Service) -> Response:
    data, filename = await service.document(id)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/{id}/reject", response_model=Case, status_code=200)
async def reject_case(
    id: str, request: RejectRequest, service: Service, actor: Actor
) -> Case:
    return await service.reject(id, request, actor)


@router.post("/{id}/resume", response_model=Case, status_code=200)
async def resume_case(id: str, service: Service, actor: Actor) -> Case:
    return await service.resume(id, actor)


@router.post("/{id}/inform", response_model=Case, status_code=200)
async def inform_case(
    id: str, request: InformRequest, service: Service, actor: Actor
) -> Case:
    return await service.inform(id, request, actor)
