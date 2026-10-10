from __future__ import annotations

from typing import Protocol

import httpx
from pydantic import ValidationError

from ..config import Settings
from ..errors import AgentFailure
from ..schemas import AgentReport, AgentRequest


class AgentRuntime(Protocol):
    async def investigate(self, request: AgentRequest) -> AgentReport: ...


class HttpAgentRuntime:
    def __init__(self, http: httpx.AsyncClient, settings: Settings) -> None:
        self.http = http
        self.settings = settings

    async def investigate(self, request: AgentRequest) -> AgentReport:
        try:
            response = await self.http.post(
                self.settings.agent_runtime_url.rstrip("/") + "/v1/investigate",
                headers={"X-Service-Key": self.settings.runtime_api_key.get_secret_value()},
                json=request.model_dump(mode="json"),
                timeout=self.settings.agent_timeout,
            )
            response.raise_for_status()
            return AgentReport.model_validate_json(response.content)
        except httpx.HTTPError as exc:
            raise AgentFailure(f"Agent runtime request failed: {type(exc).__name__}") from exc
        except ValidationError as exc:
            raise AgentFailure("Agent runtime returned an invalid report") from exc
