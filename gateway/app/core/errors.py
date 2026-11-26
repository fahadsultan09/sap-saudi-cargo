from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from .error_messages import translate
from .schemas import ErrorDetail, ErrorResponse

logger = logging.getLogger(__name__)


class AppError(Exception):
    status_code = 500
    code = "internal_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class UpstreamUnavailable(AppError):
    status_code = 502
    code = "ap_core_unavailable"


class NotSignedIn(AppError):
    status_code = 401
    code = "not_signed_in"


class NotPermitted(AppError):
    status_code = 403
    code = "not_permitted"


class IdentityUnavailable(AppError):
    status_code = 502
    code = "identity_unavailable"


def error_response(
    status: int, code: str, message: str, details: list[dict[str, object]] | None = None
) -> JSONResponse:
    body = ErrorResponse(
        error=ErrorDetail(code=code, message=message, details=details or [])
    )
    return JSONResponse(status_code=status, content=body.model_dump(mode="json"))


def register_handlers(app: FastAPI) -> None:
    async def application_error(_: Request, exc: AppError) -> JSONResponse:
        logger.warning("%s: %s", exc.code, exc.__cause__ or exc.message)
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
        friendly = translate(exc.status_code, {"detail": exc.detail})
        return error_response(exc.status_code, friendly.code, friendly.message)

    async def unexpected_error(_: Request, exc: Exception) -> JSONResponse:
        logger.error("Unexpected application failure", exc_info=exc)
        return error_response(
            500, "internal_error",
            "Something went wrong. Please try again; if it keeps happening, contact IT support.",
        )

    app.add_exception_handler(AppError, application_error)
    app.add_exception_handler(RequestValidationError, request_error)
    app.add_exception_handler(HTTPException, http_error)
    app.add_exception_handler(Exception, unexpected_error)
