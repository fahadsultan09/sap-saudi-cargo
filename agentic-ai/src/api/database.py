from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from .config import API_DATA_DIR, DB_PATH


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def connect() -> sqlite3.Connection:
    API_DATA_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 15000")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS ap_cases (
            id TEXT PRIMARY KEY,
            file_name TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            status TEXT NOT NULL,
            created_by TEXT NOT NULL,
            last_edited_by TEXT,
            invoice_number TEXT,
            supplier_name TEXT,
            supplier_id TEXT,
            company_code TEXT,
            currency TEXT,
            total_amount TEXT,
            invoice_date TEXT,
            po_number TEXT,
            document_type TEXT,
            invoice_type TEXT,
            extracted_fields_json TEXT NOT NULL DEFAULT '{}',
            line_items_json TEXT NOT NULL DEFAULT '[]',
            validation_json TEXT NOT NULL DEFAULT '{}',
            confirmed_checks_json TEXT NOT NULL DEFAULT '[]',
            review_reason TEXT,
            version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_ap_cases_status_created ON ap_cases(status, created_at);
        CREATE INDEX IF NOT EXISTS ix_ap_cases_sha256 ON ap_cases(sha256);
        CREATE TABLE IF NOT EXISTS approval_requests (
            id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL REFERENCES ap_cases(id),
            stage INTEGER NOT NULL DEFAULT 1,
            assigned_approver_id TEXT,
            status TEXT NOT NULL,
            policy_version TEXT NOT NULL DEFAULT 'poc-v1',
            created_at TEXT NOT NULL,
            completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS ix_approval_queue ON approval_requests(status, created_at);
        CREATE TABLE IF NOT EXISTS approval_decisions (
            id TEXT PRIMARY KEY,
            approval_request_id TEXT NOT NULL REFERENCES approval_requests(id),
            case_id TEXT NOT NULL REFERENCES ap_cases(id),
            decision TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            actor_role TEXT NOT NULL,
            comment TEXT NOT NULL,
            policy_version TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_events (
            id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL REFERENCES ap_cases(id),
            event_type TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            actor_role TEXT NOT NULL,
            correlation_id TEXT,
            reason TEXT,
            before_json TEXT,
            after_json TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_audit_case_time ON audit_events(case_id, created_at);
        CREATE TABLE IF NOT EXISTS posting_records (
            id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL REFERENCES ap_cases(id),
            idempotency_key TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL,
            sap_document_number TEXT,
            company_code TEXT,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """)


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str, separators=(",", ":"))


def json_load(value: str | None, fallback: Any = None) -> Any:
    if not value:
        return {} if fallback is None else fallback
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return {} if fallback is None else fallback


def audit(conn: sqlite3.Connection, *, event_id: str, case_id: str, event_type: str,
          actor_id: str, actor_role: str, reason: str = "", before: Any = None,
          after: Any = None, metadata: Any = None, correlation_id: str | None = None) -> None:
    conn.execute("""INSERT INTO audit_events
        (id, case_id, event_type, actor_id, actor_role, correlation_id, reason, before_json, after_json, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (event_id, case_id, event_type, actor_id, actor_role, correlation_id, reason,
         json_dump(before) if before is not None else None,
         json_dump(after) if after is not None else None,
         json_dump(metadata or {}), utc_now()))


def row_to_case(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    for col, fallback in (("extracted_fields_json", {}), ("line_items_json", []),
                          ("validation_json", {}), ("confirmed_checks_json", [])):
        item[col.removesuffix("_json")] = json_load(item.pop(col), fallback)
    item.pop("stored_path", None)
    return item
