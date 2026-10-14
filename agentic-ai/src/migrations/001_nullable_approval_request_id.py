from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

from api.config import DB_PATH
from api.database import connect


def migrate() -> None:
    """Make approval_decisions.approval_request_id nullable, preserving rows.

    Run from the agentic-ai project root with the virtualenv active:
        PYTHONPATH=src python migrations/001_nullable_approval_request_id.py
    """
    db_path = Path(DB_PATH)
    if not db_path.exists():
        raise FileNotFoundError(
            f"Database not found at {db_path}. Check api.config.DB_PATH."
        )

    backup_path = db_path.with_name(
        f"{db_path.stem}.before_nullable_approval_request_id_"
        f"{datetime.now().strftime('%Y%m%d_%H%M%S')}{db_path.suffix}"
    )
    shutil.copy2(db_path, backup_path)
    print(f"Database backup created: {backup_path}")

    conn = connect()
    try:
        # Must be set outside a transaction in SQLite.
        conn.execute("PRAGMA foreign_keys = OFF")

        columns = conn.execute(
            "PRAGMA table_info(approval_decisions)"
        ).fetchall()
        if not columns:
            raise RuntimeError(
                "Table approval_decisions does not exist. Initialize the database first."
            )

        column = next(
            (item for item in columns if item["name"] == "approval_request_id"),
            None,
        )
        if column is None:
            raise RuntimeError(
                "Column approval_request_id was not found in approval_decisions."
            )

        if column["notnull"] == 0:
            print("No migration needed: approval_request_id is already nullable.")
            return

        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute("""
                CREATE TABLE approval_decisions_new (
                    id TEXT PRIMARY KEY,
                    approval_request_id TEXT REFERENCES approval_requests(id),
                    case_id TEXT NOT NULL REFERENCES ap_cases(id),
                    decision TEXT NOT NULL,
                    actor_id TEXT NOT NULL,
                    actor_role TEXT NOT NULL,
                    comment TEXT NOT NULL,
                    policy_version TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)
            conn.execute("""
                INSERT INTO approval_decisions_new (
                    id, approval_request_id, case_id, decision,
                    actor_id, actor_role, comment, policy_version, created_at
                )
                SELECT
                    id, approval_request_id, case_id, decision,
                    actor_id, actor_role, comment, policy_version, created_at
                FROM approval_decisions
            """)
            conn.execute("DROP TABLE approval_decisions")
            conn.execute(
                "ALTER TABLE approval_decisions_new RENAME TO approval_decisions"
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

        migrated_columns = conn.execute(
            "PRAGMA table_info(approval_decisions)"
        ).fetchall()
        migrated_column = next(
            item for item in migrated_columns
            if item["name"] == "approval_request_id"
        )
        if migrated_column["notnull"] != 0:
            raise RuntimeError("Migration verification failed: column is still NOT NULL.")

        violations = conn.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError(
                f"Foreign-key check found {len(violations)} violation(s). "
                f"Backup is available at {backup_path}."
            )

        count = conn.execute(
            "SELECT COUNT(*) FROM approval_decisions"
        ).fetchone()[0]
        print("Migration completed successfully.")
        print("approval_decisions.approval_request_id is now nullable.")
        print(f"Preserved decision rows: {count}")
        print(f"Backup: {backup_path}")
    finally:
        if conn.in_transaction:
            conn.rollback()
        conn.execute("PRAGMA foreign_keys = ON")
        conn.close()


if __name__ == "__main__":
    migrate()
