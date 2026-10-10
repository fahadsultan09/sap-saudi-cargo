from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import time
from uuid import uuid4

from pydantic import ValidationError

from .config import Settings
from .errors import ConfigurationFailure, ToolTokenInvalid
from .schemas import Invoice, ToolClaims


def _encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _signature(settings: Settings, body: str) -> str:
    secret = settings.tool_token_secret.get_secret_value()
    if not secret:
        raise ConfigurationFailure("Tool token secret is not configured")
    return _encode(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())


def issue(settings: Settings, case_id: str, invoice: Invoice) -> str:
    claims = ToolClaims(
        jti=uuid4().hex,
        case_id=case_id,
        po=invoice.po_number,
        vendor=invoice.vendor,
        invoice_number=invoice.invoice_number,
        exp=int(time.time()) + settings.tool_token_ttl,
    )
    body = _encode(claims.model_dump_json().encode())
    return f"{body}.{_signature(settings, body)}"


def verify(settings: Settings, token: str) -> ToolClaims:
    body, _, signature = token.partition(".")
    if not hmac.compare_digest(signature.encode(), _signature(settings, body).encode()):
        raise ToolTokenInvalid("Tool token signature is invalid")
    try:
        claims = ToolClaims.model_validate_json(_decode(body))
    except (binascii.Error, ValueError, ValidationError) as exc:
        raise ToolTokenInvalid("Tool token is malformed") from exc
    if claims.exp < time.time():
        raise ToolTokenInvalid("Tool token has expired")
    return claims
