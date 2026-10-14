from __future__ import annotations

import json
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
try:
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / "config" / ".env", override=False)
except ImportError:
    pass

API_DATA_DIR = Path(os.getenv("AP_DATA_DIR", str(PROJECT_ROOT / "runtime_data")))
UPLOAD_DIR = Path(os.getenv("AP_UPLOAD_DIR", str(API_DATA_DIR / "uploads")))
DB_PATH = Path(os.getenv("AP_DB_PATH", str(API_DATA_DIR / "ap_workflow.sqlite3")))
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
AUTH_MODE = os.getenv("AUTH_MODE", "dev").strip().lower()
JWT_SECRET = os.getenv("AUTH_JWT_SECRET", "")
JWT_ISSUER = os.getenv("AUTH_JWT_ISSUER", "")
JWT_AUDIENCE = os.getenv("AUTH_JWT_AUDIENCE", "")
SAP_PROCESSING_ENABLED = os.getenv("SAP_PROCESSING_ENABLED", "false").strip().lower() == "true"
# Modes: disabled (safe manual fallback), mock (offline agent-flow demo), sap (real SAP services).
AGENT_MODE = os.getenv("AGENT_MODE", "sap" if SAP_PROCESSING_ENABLED else "disabled").strip().lower()
MAX_UPLOAD_MB = int(os.getenv("AP_MAX_UPLOAD_MB", "20"))
APPROVER_MAX_AMOUNT = os.getenv("AP_APPROVER_MAX_AMOUNT", "1000000")
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}


def _require_real_service_key(path: Path, service_name: str, required_paths: tuple[tuple[str, ...], ...]) -> None:
    """Fail fast when live mode has missing, malformed, or example credentials."""
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    if not path.is_file():
        raise RuntimeError(f"Live SAP mode requires {service_name} service key at {path}")
    try:
        with path.open(encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"{service_name} service key is not valid JSON: {path}") from exc

    for key_path in required_paths:
        value = payload
        for part in key_path:
            value = value.get(part) if isinstance(value, dict) else None
        if not isinstance(value, str) or not value.strip() or "<" in value or ">" in value:
            dotted = ".".join(key_path)
            raise RuntimeError(f"{service_name} service key is missing a real value for '{dotted}' in {path}")

def validate_config() -> None:
    if AGENT_MODE not in {"disabled", "mock", "sap"}:
        raise RuntimeError("AGENT_MODE must be disabled, mock, or sap")
    if AGENT_MODE == "sap" and not SAP_PROCESSING_ENABLED:
        raise RuntimeError("AGENT_MODE=sap requires SAP_PROCESSING_ENABLED=true")
    if AGENT_MODE == "sap":
        from triage.config import SAP_CREDENTIALS_FILE, SAP_DOC_AI_CREDENTIALS_FILE
        _require_real_service_key(
            Path(SAP_CREDENTIALS_FILE), "SAP AI Core",
            (("url",), ("clientid",), ("clientsecret",), ("serviceurls", "AI_API_URL")),
        )
        _require_real_service_key(
            Path(SAP_DOC_AI_CREDENTIALS_FILE), "SAP Document AI",
            (("uaa", "url"), ("uaa", "clientid"), ("uaa", "clientsecret"), ("url",)),
        )
    if AUTH_MODE not in {"dev", "jwt"}:
        raise RuntimeError("AUTH_MODE must be 'dev' or 'jwt'")
    if AUTH_MODE == "dev" and APP_ENV != "development":
        raise RuntimeError("AUTH_MODE=dev is allowed only when APP_ENV=development")
    if AUTH_MODE == "jwt" and len(JWT_SECRET) < 32:
        raise RuntimeError("AUTH_JWT_SECRET must contain at least 32 characters when AUTH_MODE=jwt")
