from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from .schemas import ErrorDetail, ErrorResponse

logger = logging.getLogger(__name__)


class AppError(Exception):
    status_code = 500
    code = "internal_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotFound(AppError):
    status_code = 404
    code = "not_found"


class InvalidTransition(AppError):
    status_code = 409
    code = "invalid_transition"


class ValidationFailure(AppError):
    status_code = 422
    code = "validation_failure"


class SamePersonApproval(AppError):
    status_code = 403
    code = "same_person_approval"


class DuplicatePost(AppError):
    status_code = 409
    code = "duplicate_post"


class SapPostingRejected(AppError):
    status_code = 409
    code = "sap_posting_rejected"


class PackageHashMismatch(AppError):
    status_code = 409
    code = "package_hash_mismatch"


class DocumentAIFailure(AppError):
    status_code = 502
    code = "document_ai_failure"


class AgentFailure(AppError):
    status_code = 502
    code = "agent_failed"


class SAPUnavailable(AppError):
    status_code = 503
    code = "sap_unavailable"


class ToolTokenInvalid(AppError):
    status_code = 401
    code = "tool_token_invalid"


class ToolAccessDenied(AppError):
    status_code = 403
    code = "tool_access_denied"


class AuthenticationFailure(AppError):
    status_code = 401
    code = "authentication_failure"


class ConfigurationFailure(AppError):
    status_code = 503
    code = "configuration_failure"


class UnsupportedDocument(AppError):
    status_code = 415
    code = "unsupported_document"


class UploadTooLarge(AppError):
    status_code = 413
    code = "upload_too_large"


class ConcurrentUpdate(AppError):
    status_code = 409
    code = "concurrent_update"


class StorageFailure(AppError):
    status_code = 503
    code = "storage_failure"


def error_response(
    status: int, code: str, message: str, details: list[dict[str, object]] | None = None
) -> JSONResponse:
    body = ErrorResponse(
        error=ErrorDetail(code=code, message=message, details=details or [])
    )
    return JSONResponse(status_code=status, content=body.model_dump(mode="json"))


def register_handlers(app: FastAPI) -> None:
    async def application_error(_: Request, exc: AppError) -> JSONResponse:
        return error_response(exc.status_code, exc.code, exc.message)

    async def request_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {
                "location": list(item["loc"]),
                "message": item["msg"],
                "type": item["type"],
            }
            for item in exc.errors()
        ]
        return error_response(422, "request_validation", "Invalid request", details)

    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        return error_response(exc.status_code, "http_error", str(exc.detail))

    async def unexpected_error(_: Request, exc: Exception) -> JSONResponse:
        logger.error("Unexpected application failure", exc_info=exc)
        return error_response(500, "internal_error", "Unexpected application failure")

    app.add_exception_handler(AppError, application_error)
    app.add_exception_handler(RequestValidationError, request_error)
    app.add_exception_handler(HTTPException, http_error)
    app.add_exception_handler(Exception, unexpected_error)
