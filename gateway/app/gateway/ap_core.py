from __future__ import annotations

import httpx

from ..config import Settings
from ..core.errors import UpstreamUnavailable


class APCore:
    """HTTP client for AP Core, which owns the cases, their state and the audit trail.

    The gateway signs in to AP Core with the service key, like a technical user on SAP BTP; the
    person behind each call travels in the identity headers set by the proxy.
    """

    def __init__(self, http: httpx.AsyncClient, settings: Settings) -> None:
        self.http = http
        self.base_url = settings.ap_core_url.rstrip("/")
        self.service_headers = {"x-ap-core-key": settings.ap_core_service_api_key}

    async def forward(
        self, method: str, path: str, query: str, headers: dict[str, str], body: bytes
    ) -> httpx.Response:
        url = self.base_url + path + (f"?{query}" if query else "")
        try:
            return await self.http.request(
                method, url, headers={**headers, **self.service_headers}, content=body
            )
        except httpx.HTTPError as exc:
            raise UpstreamUnavailable(
                "The invoice service is not available right now. Please try again in a few minutes."
            ) from exc

    async def reachable(self) -> bool:
        try:
            response = await self.http.get(self.base_url + "/health")
        except httpx.HTTPError:
            return False
        return response.is_success
