from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .enums import CaseStatus
from .errors import (
    ConcurrentUpdate,
    DuplicatePost,
    NotFound,
    SapPostingRejected,
    StorageFailure,
)
from .schemas import (
    AuditEvent,
    Case,
    CaseList,
    Dashboard,
    PostingPackage,
    SapDocument,
    SimilarCase,
)
from .utils import utc_now

EventData = tuple[str, dict[str, object]]
CLOSED_STATUSES = (
    CaseStatus.INFORMED,
    CaseStatus.RECONCILED,
    CaseStatus.REJECTED,
    CaseStatus.POST_FAILED,
)


class Repository:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        connection: sqlite3.Connection | None = None
        try:
            with sqlite3.connect(self.database_path, timeout=30) as connection:
                connection.row_factory = sqlite3.Row
                connection.execute("PRAGMA foreign_keys=ON")
                yield connection
        except sqlite3.Error as exc:
            raise StorageFailure("Database operation failed") from exc
        finally:
            if connection is not None:
                connection.close()

    def initialize(self) -> None:
        try:
            self.database_path.parent.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise StorageFailure("Cannot initialize database directory") from exc
        with self.connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS cases (
                    id TEXT PRIMARY KEY, version INTEGER NOT NULL,
                    status TEXT NOT NULL, payload TEXT NOT NULL,
                    vendor TEXT, invoice_number TEXT
                );
                CREATE INDEX IF NOT EXISTS cases_invoice ON cases(vendor, invoice_number);
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    case_id TEXT NOT NULL REFERENCES cases(id),
                    timestamp TEXT NOT NULL, kind TEXT NOT NULL,
                    actor TEXT NOT NULL, data TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS events_case ON events(case_id, id);
                CREATE TABLE IF NOT EXISTS dispatch_claims (
                    case_id TEXT PRIMARY KEY REFERENCES cases(id),
                    idempotency_key TEXT NOT NULL UNIQUE
                );
                CREATE TABLE IF NOT EXISTS mock_sap_documents (
                    id TEXT PRIMARY KEY, vendor TEXT NOT NULL,
                    invoice_number TEXT NOT NULL, package TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    UNIQUE(vendor, invoice_number)
                );
            """)

    def _events(
        self,
        connection: sqlite3.Connection,
        case_id: str,
        actor: str,
        events: list[EventData],
    ) -> None:
        connection.executemany(
            "INSERT INTO events(case_id,timestamp,kind,actor,data) VALUES(?,?,?,?,?)",
            [
                (case_id, utc_now().isoformat(), kind, actor, json.dumps(data))
                for kind, data in events
            ],
        )

    def create(self, case: Case, actor: str, events: list[EventData]) -> Case:
        with self.connection() as connection:
            connection.execute(
                "INSERT INTO cases(id,version,status,payload,vendor,invoice_number) "
                "VALUES(?,?,?,?,?,?)",
                (
                    case.id,
                    case.version,
                    case.status.value,
                    case.model_dump_json(),
                    case.invoice.vendor if case.invoice else None,
                    case.invoice.invoice_number if case.invoice else None,
                ),
            )
            self._events(connection, case.id, actor, events)
        return case

    def get(self, case_id: str) -> Case:
        with self.connection() as connection:
            row = connection.execute(
                "SELECT payload FROM cases WHERE id=?", (case_id,)
            ).fetchone()
        if row is None:
            raise NotFound("Case not found")
        return Case.model_validate_json(row["payload"])

    def save(
        self,
        case: Case,
        actor: str,
        events: list[EventData],
        claim_key: str | None = None,
        release_claim: bool = False,
    ) -> Case:
        previous_version = case.version
        case.version += 1
        case.updated_at = utc_now()
        with self.connection() as connection:
            # Claim release and case recovery must commit or roll back together.
            if release_claim:
                connection.execute(
                    "DELETE FROM dispatch_claims WHERE case_id=?", (case.id,)
                )
            if claim_key is not None:
                try:
                    connection.execute(
                        "INSERT INTO dispatch_claims VALUES(?,?)", (case.id, claim_key)
                    )
                except sqlite3.IntegrityError as exc:
                    raise DuplicatePost(
                        "Case or idempotency key has already been claimed"
                    ) from exc
            changed = connection.execute(
                "UPDATE cases SET version=?,status=?,payload=?,vendor=?,invoice_number=? "
                "WHERE id=? AND version=?",
                (
                    case.version,
                    case.status.value,
                    case.model_dump_json(),
                    case.invoice.vendor if case.invoice else None,
                    case.invoice.invoice_number if case.invoice else None,
                    case.id,
                    previous_version,
                ),
            ).rowcount
            if changed != 1:
                raise ConcurrentUpdate(
                    "Case changed concurrently; reload it before retrying"
                )
            self._events(connection, case.id, actor, events)
        return case

    def record_event(
        self, case_id: str, actor: str, kind: str, data: dict[str, object]
    ) -> None:
        with self.connection() as connection:
            self._events(connection, case_id, actor, [(kind, data)])

    def list(self, status: CaseStatus | None, limit: int, offset: int) -> CaseList:
        with self.connection() as connection:
            total = connection.execute(
                "SELECT COUNT(*) FROM cases WHERE (? IS NULL OR status=?)",
                (status, status),
            ).fetchone()[0]
            rows = connection.execute(
                "SELECT payload FROM cases WHERE (? IS NULL OR status=?) "
                "ORDER BY rowid DESC LIMIT ? OFFSET ?",
                (status, status, limit, offset),
            ).fetchall()
        return CaseList(
            items=[Case.model_validate_json(row["payload"]) for row in rows],
            total=total,
            limit=limit,
            offset=offset,
        )

    def events(
        self, case_id: str | None, after_id: int, limit: int
    ) -> list[AuditEvent]:
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT * FROM events WHERE id>? AND (? IS NULL OR case_id=?) "
                "ORDER BY id LIMIT ?",
                (after_id, case_id, case_id, limit),
            ).fetchall()
        return [
            AuditEvent(
                id=row["id"],
                case_id=row["case_id"],
                timestamp=row["timestamp"],
                kind=row["kind"],
                actor=row["actor"],
                data=json.loads(row["data"]),
            )
            for row in rows
        ]

    def dashboard(self) -> Dashboard:
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT status,COUNT(*) AS count FROM cases GROUP BY status"
            ).fetchall()
        counts = dict.fromkeys(CaseStatus, 0)
        counts.update({CaseStatus(row["status"]): row["count"] for row in rows})
        return Dashboard(total=sum(counts.values()), counts=counts)

    def mock_duplicate(self, vendor: str, invoice_number: str) -> bool:
        with self.connection() as connection:
            row = connection.execute(
                "SELECT 1 FROM mock_sap_documents WHERE vendor=? AND invoice_number=?",
                (vendor, invoice_number),
            ).fetchone()
        return row is not None

    def other_case_duplicate(
        self, case_id: str, vendor: str, invoice_number: str
    ) -> bool:
        with self.connection() as connection:
            row = connection.execute(
                "SELECT 1 FROM cases WHERE rowid<(SELECT rowid FROM cases WHERE id=?) "
                "AND vendor=? AND invoice_number=? "
                "AND status NOT IN (?,?) LIMIT 1",
                (
                    case_id,
                    vendor,
                    invoice_number,
                    CaseStatus.REJECTED.value,
                    CaseStatus.POST_FAILED.value,
                ),
            ).fetchone()
        return row is not None

    def similar_cases(
        self, case_id: str, vendor: str, limit: int
    ) -> list[SimilarCase]:
        placeholders = ",".join("?" * len(CLOSED_STATUSES))
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT invoice_number,status FROM cases WHERE vendor=? AND id<>? "
                f"AND status IN ({placeholders}) ORDER BY rowid DESC LIMIT ?",
                (vendor, case_id, *(status.value for status in CLOSED_STATUSES), limit),
            ).fetchall()
        return [
            SimilarCase(inv_no=row["invoice_number"], status=row["status"])
            for row in rows
        ]

    def mock_post(
        self, document_id: str, package: PostingPackage, idempotency_key: str
    ) -> SapDocument:
        with self.connection() as connection:
            try:
                connection.execute(
                    "INSERT INTO mock_sap_documents VALUES(?,?,?,?,?)",
                    (
                        document_id,
                        package.invoice.vendor,
                        package.invoice.invoice_number,
                        package.model_dump_json(),
                        idempotency_key,
                    ),
                )
            except sqlite3.IntegrityError as exc:
                raise SapPostingRejected(
                    "Vendor invoice or posting key already exists in SAP"
                ) from exc
        return SapDocument(id=document_id, package=package)

    def mock_read(self, document_id: str) -> SapDocument:
        with self.connection() as connection:
            row = connection.execute(
                "SELECT package FROM mock_sap_documents WHERE id=?", (document_id,)
            ).fetchone()
        if row is None:
            raise NotFound("SAP document not found")
        return SapDocument(
            id=document_id, package=PostingPackage.model_validate_json(row["package"])
        )

    def mock_find_posting(self, idempotency_key: str) -> SapDocument | None:
        with self.connection() as connection:
            row = connection.execute(
                "SELECT id,package FROM mock_sap_documents WHERE idempotency_key=?",
                (idempotency_key,),
            ).fetchone()
        if row is None:
            return None
        return SapDocument(
            id=row["id"], package=PostingPackage.model_validate_json(row["package"])
        )
