from __future__ import annotations
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.getenv("AP_CORE_DB_PATH", str(ROOT / "runtime_data" / "ap_core.sqlite3")))
SERVICE_API_KEY = os.getenv("AP_CORE_SERVICE_API_KEY", "")
APP_ENV = os.getenv("APP_ENV", "development").lower()
MAX_WORK_ATTEMPTS = int(os.getenv("AP_CORE_MAX_WORK_ATTEMPTS", "5"))
LEASE_SECONDS = int(os.getenv("AP_CORE_LEASE_SECONDS", "120"))
