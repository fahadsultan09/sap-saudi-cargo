from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Body, Depends, File, Query, Response, UploadFile

from ..dependencies import actor_dependency, case_service_dependency, require_roles
from ..enums import CaseStatus, Role
from ..schemas import (
    Actor,
    Case,
    CaseHistory,
    CaseList,
    CommentRequest,
    ConfirmRequest,
    InformRequest,
    Invoice,
    RejectRequest,
    ReviewRequest,
)
from ..services.case_service import CaseService

router = APIRouter(prefix="/api/v1/cases", tags=["cases"])
Service = Annotated[CaseService, Depends(case_service_dependency)]
Processor = Annotated[Actor, Depends(require_roles(Role.AP_PROCESSOR))]
Approver = Annotated[Actor, Depends(require_roles(Role.AP_APPROVER))]
Decider = Annotated[Actor, Depends(require_roles(Role.AP_PROCESSOR, Role.AP_APPROVER))]
Reader = [Depends(actor_dependency)]


@router.post("/upload", response_model=Case, status_code=201)
async def upload_case(
    service: Service,
    actor: Processor,
    file: Annotated[UploadFile, File(description="Original invoice: PDF, PNG or JPEG")],
) -> Case:
    return await service.upload(file, actor.user_id)


@router.post("", response_model=Case, status_code=201)
async def create_case(invoice: Invoice, service: Service, actor: Processor) -> Case:
    return await service.create(invoice, actor.user_id)


@router.get("", response_model=CaseList, status_code=200, dependencies=Reader)
async def list_cases(
    service: Service,
    status: CaseStatus | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> CaseList:
    return await service.list(status, limit, offset)


@router.get("/{id}", response_model=Case, status_code=200, dependencies=Reader)
async def get_case(id: str, service: Service) -> Case:
    return await service.get(id)


@router.get(
    "/{id}/history", response_model=CaseHistory, status_code=200, dependencies=Reader
)
async def get_history(id: str, service: Service) -> CaseHistory:
    return await service.history(id)


@router.post("/{id}/review", response_model=Case, status_code=200)
async def review_case(
    id: str, request: ReviewRequest, service: Service, actor: Processor
) -> Case:
    return await service.review(id, request, actor.user_id)


@router.post("/{id}/decide", response_model=Case, status_code=200)
async def decide_case(id: str, service: Service, actor: Processor) -> Case:
    return await service.decide(id, actor.user_id)


@router.post("/{id}/confirm", response_model=Case, status_code=200)
async def confirm_case(
    id: str,
    service: Service,
    actor: Processor,
    request: Annotated[ConfirmRequest | None, Body()] = None,
) -> Case:
    return await service.confirm(id, request, actor.user_id)


@router.post("/{id}/approve", response_model=Case, status_code=200)
async def approve_case(
    id: str, request: CommentRequest, service: Service, actor: Approver
) -> Case:
    return await service.approve(id, request, actor.user_id)


@router.post("/{id}/return", response_model=Case, status_code=200)
async def return_case(
    id: str, request: CommentRequest, service: Service, actor: Approver
) -> Case:
    return await service.return_case(id, request, actor.user_id)


@router.get(
    "/{id}/document",
    response_model=None,
    response_class=Response,
    status_code=200,
    responses={
        200: {
            "description": "Original invoice document",
            "content": {
                media_type: {"schema": {"type": "string", "format": "binary"}}
                for media_type in ("application/pdf", "image/png", "image/jpeg")
            },
        }
    },
    dependencies=Reader,
)
async def get_document(id: str, service: Service) -> Response:
    data, filename, media_type = await service.document(id)
    return Response(
        content=data,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/{id}/reject", response_model=Case, status_code=200)
async def reject_case(
    id: str, request: RejectRequest, service: Service, actor: Decider
) -> Case:
    return await service.reject(id, request, actor.user_id)


@router.post("/{id}/resume", response_model=Case, status_code=200)
async def resume_case(id: str, service: Service, actor: Processor) -> Case:
    return await service.resume(id, actor.user_id)


@router.post("/{id}/inform", response_model=Case, status_code=200)
async def inform_case(
    id: str, request: InformRequest, service: Service, actor: Processor
) -> Case:
    return await service.inform(id, request, actor.user_id)
