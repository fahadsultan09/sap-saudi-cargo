from __future__ import annotations

import httpx

from ..config import Settings
from ..core.errors import UpstreamUnavailable


class AgenticAPI:
    """HTTP client for Fahad's agentic API, which owns the cases, agents and database."""

    def __init__(self, http: httpx.AsyncClient, settings: Settings) -> None:
        self.http = http
        self.base_url = settings.agentic_api_url.rstrip("/")

    async def forward(
        self, method: str, path: str, query: str, headers: dict[str, str], body: bytes
    ) -> httpx.Response:
        url = self.base_url + path + (f"?{query}" if query else "")
        try:
            return await self.http.request(method, url, headers=headers, content=body)
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
