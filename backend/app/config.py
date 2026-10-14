from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_path: Path
    storage_path: Path
    rules_path: Path = Path(__file__).parent / "rules.json"
    port: int = Field(default=8000, ge=1, le=65535)
    auth_mode: Literal["local", "trusted_header"] = "local"
    trusted_proxy_token: SecretStr = SecretStr("")
    internal_api_token: SecretStr = SecretStr("")
    document_ai_url: str = ""
    document_ai_token: SecretStr = SecretStr("")
    document_ai_client_id: str = "default"
    document_ai_poll_interval: float = Field(default=1, gt=0)
    document_ai_poll_attempts: int = Field(default=60, ge=1)
    agent_runtime_url: str = ""
    runtime_api_key: SecretStr = SecretStr("")
    agent_timeout: float = Field(default=70, gt=0)
    tool_token_secret: SecretStr = SecretStr("")
    tool_token_ttl: int = Field(default=180, ge=1)
    sap_mode: Literal["mock", "real"] = "mock"
    sap_url: str = ""
    sap_token: SecretStr = SecretStr("")
    mock_missing_gr_posted: bool = False
    posting_stale_seconds: int = Field(default=300, gt=0)
    http_timeout: float = Field(default=30, gt=0)
    max_upload_bytes: int = Field(default=10485760, ge=1)
    confidence_threshold: float = Field(default=0.85, ge=0, le=1)
    sse_poll_interval: float = Field(default=1, gt=0)
    sse_heartbeat_seconds: float = Field(default=15, gt=0)


@lru_cache
def get_settings() -> Settings:
    return Settings()
