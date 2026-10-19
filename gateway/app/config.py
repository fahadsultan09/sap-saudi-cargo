from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Deployment settings and secrets, read from the git-ignored .env (template: .env.example)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ap_core_url: str = "http://127.0.0.1:8002"
    port: int = Field(default=8000, ge=1, le=65535)
    http_timeout: float = Field(default=30, gt=0)

    # The client this deployment serves: a folder with client.json, logo and Keycloak realm.
    client_profile: Path = Path("../clients/saudi-cargo")
    # Which roles may call which /api route (like SAP's xs-app.json route scopes).
    access_rules: Path = Path("access-rules.json")
    # The address users open; login redirects come back here.
    public_url: str = "http://localhost:8000"
    # The UI: a dev server to proxy to, or a folder of built files (production).
    frontend_url: str | None = "http://localhost:8080"
    frontend_dir: Path | None = None

    oidc_client_secret: str
    # Must equal AP_CORE_SERVICE_API_KEY in ap-core-service/.env.
    ap_core_service_api_key: str
    session_cookie: str = "ap_session"
    session_cookie_secure: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
