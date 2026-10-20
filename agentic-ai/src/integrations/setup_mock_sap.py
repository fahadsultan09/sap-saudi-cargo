
from __future__ import annotations

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "runtime_data" / "mock_sap.sqlite3"


def setup() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript("""
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS suppliers (
            supplier_id TEXT PRIMARY KEY,
            supplier_name TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS purchase_orders (
            po_number TEXT PRIMARY KEY,
            supplier_id TEXT NOT NULL,
            company_code TEXT NOT NULL,
            currency TEXT NOT NULL,
            status TEXT NOT NULL,
            total_amount TEXT NOT NULL,
            FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id)
        );

        CREATE TABLE IF NOT EXISTS po_lines (
            po_number TEXT NOT NULL,
            line_number INTEGER NOT NULL,
            description TEXT,
            material_id TEXT,
            quantity TEXT NOT NULL,
            unit_price TEXT NOT NULL,
            amount TEXT NOT NULL,
            PRIMARY KEY (po_number, line_number),
            FOREIGN KEY (po_number) REFERENCES purchase_orders(po_number)
        );

        CREATE TABLE IF NOT EXISTS goods_receipts (
            receipt_id TEXT PRIMARY KEY,
            po_number TEXT NOT NULL,
            line_number INTEGER NOT NULL,
            received_quantity TEXT NOT NULL,
            status TEXT NOT NULL,
            FOREIGN KEY (po_number, line_number)
                REFERENCES po_lines(po_number, line_number)
        );

        CREATE TABLE IF NOT EXISTS prior_invoices (
            invoice_id TEXT PRIMARY KEY,
            invoice_number TEXT NOT NULL,
            supplier_id TEXT NOT NULL,
            po_number TEXT,
            currency TEXT NOT NULL,
            amount TEXT NOT NULL,
            status TEXT NOT NULL
        );
        """)

        # Fictional development fixtures only. Never represent these as SAP data.
        conn.execute(
            """INSERT OR IGNORE INTO suppliers
               (supplier_id, supplier_name) VALUES (?, ?)""",
            ("MOCK-V001", "Example Industrial Supplies"),
        )

        conn.execute(
            """INSERT OR IGNORE INTO purchase_orders
               (po_number, supplier_id, company_code, currency, status, total_amount)
               VALUES (?, ?, ?, ?, ?, ?)""",
            ("4500001001", "MOCK-V001", "1000", "SAR", "OPEN", "1000.00"),
        )

        conn.execute(
            """INSERT OR IGNORE INTO po_lines
               (po_number, line_number, description, material_id,
                quantity, unit_price, amount)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                "4500001001", 10, "Industrial supplies", "MOCK-MAT-001",
                "10", "100.00", "1000.00",
            ),
        )

        conn.execute(
            """INSERT OR IGNORE INTO goods_receipts
               (receipt_id, po_number, line_number, received_quantity, status)
               VALUES (?, ?, ?, ?, ?)""",
            ("MOCK-GR-001", "4500001001", 10, "8", "POSTED"),
        )

    print(f"Mock SAP database ready: {DB_PATH}")


if __name__ == "__main__":
    setup()
