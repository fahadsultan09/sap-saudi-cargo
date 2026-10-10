from __future__ import annotations

import asyncio
import json
from typing import Protocol
from urllib.parse import quote

import httpx
from pydantic import ValidationError

from ..config import Settings
from ..enums import InvoiceField
from ..errors import DocumentAIFailure
from ..schemas import ExtractedField

FIELD_NAMES = {
    "senderId": InvoiceField.VENDOR,
    "documentNumber": InvoiceField.INVOICE_NUMBER,
    "purchaseOrderNumber": InvoiceField.PO_NUMBER,
    "netAmount": InvoiceField.NET,
    "taxAmount": InvoiceField.VAT,
    "currencyCode": InvoiceField.CURRENCY,
}


class DocumentAI(Protocol):
    async def extract(
        self, data: bytes, filename: str
    ) -> dict[InvoiceField, ExtractedField]: ...


class SAPDocumentAI:
    def __init__(self, http: httpx.AsyncClient, settings: Settings) -> None:
        self.http = http
        self.settings = settings

    def _fields(self, payload: dict[str, object]) -> dict[InvoiceField, ExtractedField]:
        try:
            extraction = payload["extraction"]
            if not isinstance(extraction, dict):
                raise TypeError("Invalid extraction")
            fields = extraction["headerFields"]
            if not isinstance(fields, list):
                raise TypeError("Invalid header fields")
            result = {field: ExtractedField() for field in InvoiceField}
            seen: set[InvoiceField] = set()
            for item in fields:
                if not isinstance(item, dict):
                    raise TypeError("Invalid field")
                name = FIELD_NAMES.get(item.get("name"))
                if name is not None:
                    if name in seen:
                        raise ValueError("Duplicate extracted field")
                    seen.add(name)
                    value = item.get("value")
                    result[name] = ExtractedField(
                        value=str(value) if value is not None else None,
                        confidence=item.get("confidence", 0),
                    )
            return result
        except (KeyError, TypeError, ValueError, ValidationError) as exc:
            raise DocumentAIFailure(
                "Document AI returned an invalid extraction payload"
            ) from exc

    async def extract(
        self, data: bytes, filename: str
    ) -> dict[InvoiceField, ExtractedField]:
        token = self.settings.document_ai_token.get_secret_value()
        if not self.settings.document_ai_url or not token:
            raise DocumentAIFailure("Document AI URL and token must be configured")
        url = self.settings.document_ai_url.rstrip("/") + "/document/jobs"
        headers = {"Authorization": f"Bearer {token}"}
        options = {
            "clientId": self.settings.document_ai_client_id,
            "documentType": "invoice",
            "extraction": {"headerFields": list(FIELD_NAMES), "lineItemFields": []},
        }
        try:
            response = await self.http.post(
                url,
                headers=headers,
                data={"options": json.dumps(options)},
                files={"file": (filename, data, "application/pdf")},
            )
            response.raise_for_status()
            job_id = response.json()["id"]
            if not isinstance(job_id, str) or not job_id:
                raise ValueError("Invalid job id")
            for _ in range(self.settings.document_ai_poll_attempts):
                response = await self.http.get(
                    f"{url}/{quote(job_id, safe='')}", headers=headers
                )
                response.raise_for_status()
                payload = response.json()
                state = payload["status"]
                if state == "DONE":
                    return self._fields(payload)
                if state not in {"PENDING", "RUNNING"}:
                    raise DocumentAIFailure("Document AI extraction job failed")
                await asyncio.sleep(self.settings.document_ai_poll_interval)
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            raise DocumentAIFailure("Document AI request or response failed") from exc
        raise DocumentAIFailure("Document AI polling timed out")
