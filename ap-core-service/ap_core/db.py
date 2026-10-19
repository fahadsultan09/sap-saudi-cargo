from __future__ import annotations
import json, sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from .config import DB_PATH


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=20, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=20000")
    return c


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    c = connect()
    try:
        c.execute("BEGIN IMMEDIATE")
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


def dumps(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"), default=str)


def loads(v: str | None, fallback: Any = None) -> Any:
    if not v: return fallback
    try: return json.loads(v)
    except (ValueError, TypeError): return fallback


def init_db() -> None:
    with connect() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS cases (
          id TEXT PRIMARY KEY, source TEXT NOT NULL, file_name TEXT NOT NULL,
          sha256 TEXT NOT NULL UNIQUE, document_ref TEXT, status TEXT NOT NULL,
          invoice_number TEXT, supplier_id TEXT, supplier_name TEXT, company_code TEXT,
          currency TEXT, total_amount TEXT, invoice_date TEXT, po_number TEXT, last_edited_by TEXT,
          fields_json TEXT NOT NULL DEFAULT '{}',
          validation_json TEXT NOT NULL DEFAULT '{}', review_reason TEXT,
          version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id),
          storage_key TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL,
          content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
          sha256 TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_documents_case ON documents(case_id, created_at);
        CREATE INDEX IF NOT EXISTS ix_cases_status_updated ON cases(status, updated_at);
        CREATE INDEX IF NOT EXISTS ix_cases_business_duplicate ON cases(invoice_number, supplier_id, company_code);
        CREATE TABLE IF NOT EXISTS work_items (
          id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), task_type TEXT NOT NULL,
          status TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL, available_at TEXT NOT NULL, lease_owner TEXT, lease_until TEXT,
          idempotency_key TEXT NOT NULL UNIQUE, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_work_claim ON work_items(status, available_at, created_at);
        CREATE TABLE IF NOT EXISTS model_judgements (
          id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), agent_name TEXT NOT NULL,
          judgement_type TEXT NOT NULL, payload_json TEXT NOT NULL, model_version TEXT,
          idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rule_results (
          id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), rule_code TEXT NOT NULL,
          outcome TEXT NOT NULL, reason TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_events (
          id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), event_type TEXT NOT NULL,
          decision_class TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
          payload_json TEXT NOT NULL DEFAULT '{}', correlation_id TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS posting_commands (
          id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), package_hash TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL, sap_document_number TEXT,
          attempt_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        """)
        # Columns added after the first release; CREATE TABLE IF NOT EXISTS does not add them to an existing DB.
        existing = {r["name"] for r in c.execute("PRAGMA table_info(cases)")}
        for column in ("po_number", "last_edited_by"):
            if column not in existing:
                c.execute(f"ALTER TABLE cases ADD COLUMN {column} TEXT")
