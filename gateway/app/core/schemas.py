from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Health(Model):
    status: Literal["ok"] = "ok"
    ap_core: Literal["reachable", "unreachable"]


class ErrorDetail(Model):
    code: str
    message: str
    details: list[dict[str, object]] = Field(default_factory=list)


class ErrorResponse(Model):
    error: ErrorDetail
