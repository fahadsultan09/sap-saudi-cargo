"""Configuration for the AP Invoice Triage Agent.

All configuration is read from environment variables with sensible defaults.
Load a .env file at application startup (e.g. via python-dotenv) or set
the variables directly in the deployment environment.
"""

from __future__ import annotations

import os
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────

# Project root = parent of src/
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

# Load config/.env (real environment variables win over the file)
try:
    from dotenv import load_dotenv

    load_dotenv(PROJECT_ROOT / "config" / ".env", override=False)
except ImportError:
    pass

# Where logs, the CSV table and result files are written
OUTPUT_DIR = Path(os.getenv("TRIAGE_OUTPUT_DIR", str(PROJECT_ROOT / "output")))

# Config directory (document_types.json, etc.)
CONFIG_DIR = Path(os.getenv("TRIAGE_CONFIG_DIR", str(PROJECT_ROOT / "config")))

# Data directory (sample payloads, etc.)
DATA_DIR = Path(os.getenv("TRIAGE_DATA_DIR", str(PROJECT_ROOT / "data")))

# ── Confidence thresholds ─────────────────────────────────────────────────

MIN_CONFIDENCE_THRESHOLD = float(os.getenv("MIN_CONFIDENCE_THRESHOLD", "0.75"))
MIN_REQUIRED_FIELD_CONFIDENCE = float(
    os.getenv("MIN_REQUIRED_FIELD_CONFIDENCE", "0.80")
)

# ── SAP AI Core credentials (for classification) ────────────────────────

# Path to the SAP AI Core service-key JSON file (default: config/ai_core_cred.json)
SAP_CREDENTIALS_FILE = os.getenv(
    "SAP_CREDENTIALS_FILE", str(CONFIG_DIR / "ai_core_cred.json")
)

# ── SAP Document AI credentials (for extraction) ────────────────────────

# Path to the SAP Document AI service-key JSON file (default: config/sap_credentials.json)
SAP_DOC_AI_CREDENTIALS_FILE = os.getenv(
    "SAP_DOC_AI_CREDENTIALS_FILE", str(CONFIG_DIR / "sap_credentials.json")
)

# Optional: specify a DOX schema ID directly to bypass the schema lookup API
# (useful when /api/v1/document/schemas is unavailable or returns 404)
SAP_DOX_SCHEMA_ID = os.getenv("SAP_DOX_SCHEMA_ID", "")

# ── Optional: LLM configuration ─────────────────────────────────────────────

LLM_MODEL_NAME = os.getenv("LLM_MODEL_NAME", "gpt-4")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "")

# ── Document types config file ─────────────────────────────────────────────

DOCUMENT_TYPES_FILE = CONFIG_DIR / "document_types.json"
