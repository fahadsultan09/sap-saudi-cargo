from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile
from pydantic import ValidationError

from ..clients.document_ai import DocumentAI
from ..config import Settings
from ..enums import Action, CaseStatus, InvoiceField, RecommendationSource
from ..errors import (
    AgentFailure,
    AppError,
    DocumentAIFailure,
    NotFound,
    SamePersonApproval,
    StorageFailure,
    UnsupportedDocument,
    UploadTooLarge,
    ValidationFailure,
)
from ..repository import EventData, Repository
from ..schemas import (
    AuditEvent,
    Case,
    ConfirmRequest,
    CaseList,
    Dashboard,
    DocumentMetadata,
    ExtractedField,
    InformRequest,
    Invoice,
    PostingPackage,
    Recommendation,
    RejectRequest,
    ReviewRequest,
)
from ..state import require_status, transition
from .agent_service import AgentService
from ..utils import package_hash, safe_filename, utc_now

UPLOAD_CHUNK_BYTES = 65536
PDF_TRAILER_BYTES = 1024


class CaseService:
    def __init__(
        self,
        repository: Repository,
        document_ai: DocumentAI,
        agent: AgentService,
        settings: Settings,
    ) -> None:
        self.repository = repository
        self.document_ai = document_ai
        self.agent = agent
        self.settings = settings

    async def get(self, case_id: str) -> Case:
        return await asyncio.to_thread(self.repository.get, case_id)

    async def save(
        self,
        case: Case,
        actor: str,
        events: list[EventData],
        claim_key: str | None = None,
        release_claim: bool = False,
    ) -> Case:
        return await asyncio.to_thread(
            self.repository.save, case, actor, events, claim_key, release_claim
        )

    def _new_case(self) -> Case:
        now = utc_now()
        return Case(id=uuid4().hex, created_at=now, updated_at=now)

    def _validate_extraction(self, case: Case) -> bool:
        try:
            case.invoice = Invoice.model_validate(
                {name.value: field.value for name, field in case.fields.items()}
            )
        except ValidationError:
            case.invoice = None
        return case.invoice is not None and all(
            case.fields.get(name, ExtractedField()).confidence
            >= self.settings.confidence_threshold
            for name in InvoiceField
        )

    async def create(self, invoice: Invoice, actor: str) -> Case:
        case = self._new_case()
        case.invoice = invoice
        case.fields = {
            InvoiceField(name): ExtractedField(value=str(value), confidence=1)
            for name, value in invoice.model_dump().items()
        }
        events = [
            ("case_created", {"source": "json"}),
            transition(case, CaseStatus.EXTRACTED),
        ]
        return await asyncio.to_thread(self.repository.create, case, actor, events)

    def _document_path(self, case_id: str) -> Path:
        return self.settings.storage_path / f"{case_id}.pdf"

    def _store_document(self, case_id: str, data: bytes) -> None:
        try:
            self.settings.storage_path.mkdir(parents=True, exist_ok=True)
            with self._document_path(case_id).open("xb") as document:
                document.write(data)
        except OSError as exc:
            raise StorageFailure("Cannot store original document") from exc

    def _remove_document(self, case_id: str) -> None:
        try:
            self._document_path(case_id).unlink(missing_ok=True)
        except OSError as exc:
            raise StorageFailure("Cannot clean up uncommitted document") from exc

    async def _read_upload(self, upload: UploadFile) -> tuple[bytes, str]:
        try:
            data = bytearray()
            while chunk := await upload.read(UPLOAD_CHUNK_BYTES):
                if len(data) + len(chunk) > self.settings.max_upload_bytes:
                    raise UploadTooLarge("Invoice exceeds the configured upload limit")
                data.extend(chunk)
        finally:
            await upload.close()
        filename = safe_filename(upload.filename)
        if (
            upload.content_type != "application/pdf"
            or not filename.lower().endswith(".pdf")
            or not data.startswith(b"%PDF-")
            or b"%%EOF" not in data[-PDF_TRAILER_BYTES:]
        ):
            raise UnsupportedDocument(
                "A PDF extension, media type, header and EOF marker are required"
            )
        return bytes(data), filename

    async def upload(self, upload: UploadFile, actor: str) -> Case:
        content, filename = await self._read_upload(upload)
        case = self._new_case()
        case.document = DocumentMetadata(
            filename=filename,
            size=len(content),
            sha256=hashlib.sha256(content).hexdigest(),
        )
        await asyncio.to_thread(self._store_document, case.id, content)
        try:
            await asyncio.to_thread(
                self.repository.create,
                case,
                actor,
                [
                    ("case_created", {"source": "upload"}),
                    ("document_stored", case.document.model_dump()),
                ],
            )
        except AppError:
            await asyncio.to_thread(self._remove_document, case.id)
            raise
        return await self._extract(case, content, filename, actor)

    async def _extract(
        self, case: Case, content: bytes, filename: str, actor: str
    ) -> Case:
        try:
            case.fields = await self.document_ai.extract(content, filename)
        except DocumentAIFailure as exc:
            await self.save(
                case,
                actor,
                [
                    ("extraction_failed", {"code": exc.code}),
                    transition(case, CaseStatus.NEEDS_REVIEW),
                ],
            )
            raise DocumentAIFailure(
                f"Extraction failed; case {case.id} is available for manual review"
            ) from exc
        valid = self._validate_extraction(case)
        target = CaseStatus.EXTRACTED if valid else CaseStatus.NEEDS_REVIEW
        return await self.save(
            case,
            actor,
            [
                (
                    "document_extracted",
                    {
                        "fields": {
                            name.value: field.model_dump()
                            for name, field in case.fields.items()
                        }
                    },
                ),
                transition(case, target),
            ],
        )

    async def review(self, case_id: str, request: ReviewRequest, actor: str) -> Case:
        case = await self.get(case_id)
        require_status(case, CaseStatus.NEEDS_REVIEW, CaseStatus.EXTRACTED)
        corrections = request.model_dump(exclude_unset=True)
        if not corrections or any(value is None for value in corrections.values()):
            raise ValidationFailure("Supply at least one non-null correction")
        events: list[EventData] = []
        for name, value in corrections.items():
            field = InvoiceField(name)
            previous = case.fields.get(field, ExtractedField())
            case.fields[field] = ExtractedField(value=str(value), confidence=1)
            events.append(
                (
                    "field_corrected",
                    {
                        "field": name,
                        "old": previous.value,
                        "new": str(value),
                        "old_confidence": previous.confidence,
                    },
                )
            )
        ready = self._validate_extraction(case)
        events.append(("review_completed", {"ready": ready}))
        if ready and case.status == CaseStatus.NEEDS_REVIEW:
            events.append(transition(case, CaseStatus.EXTRACTED))
        return await self.save(case, actor, events)

    async def _decide(self, case: Case, actor: str, events: list[EventData]) -> Case:
        require_status(case, CaseStatus.EXTRACTED)
        invoice = case.invoice
        if invoice is None:
            raise ValidationFailure("A complete reviewed invoice is required")
        try:
            finding, report = await self.agent.investigate(case, invoice)
        except AgentFailure as exc:
            # Without an agent answer the case goes to a human to decide.
            case.rules = []
            case.rules_version = None
            case.recommendation = None
            events.append(("agent_unavailable", {"reason": exc.message}))
            events.append(transition(case, CaseStatus.AWAITING_CONFIRM))
            return await self.save(case, actor, events)
        case.rules = finding.rule_results
        case.rules_version = self.agent.rule_set.version
        case.recommendation = Recommendation(
            action=finding.action,
            reason=finding.summary,
            source=RecommendationSource.AGENT,
            amount=finding.amount if finding.action == Action.POST else None,
            evidence=finding.evidence,
            confidence=finding.confidence,
        )
        events.append(("agent_investigated", {"trace": report.trace, "steps": report.steps}))
        events.extend(("rule_evaluated", rule.model_dump()) for rule in case.rules)
        events.append(
            (
                "recommendation_created",
                {
                    **case.recommendation.model_dump(mode="json"),
                    "rules_version": case.rules_version,
                },
            )
        )
        target = (
            CaseStatus.WAITING_EXTERNAL
            if case.recommendation.action == Action.HOLD
            else CaseStatus.AWAITING_CONFIRM
        )
        events.append(transition(case, target))
        return await self.save(case, actor, events)

    async def decide(self, case_id: str, actor: str) -> Case:
        return await self._decide(await self.get(case_id), actor, [])

    async def confirm(
        self, case_id: str, request: ConfirmRequest | None, actor: str
    ) -> Case:
        case = await self.get(case_id)
        require_status(case, CaseStatus.AWAITING_CONFIRM)
        if case.invoice is None:
            raise ValidationFailure("A complete invoice is required")
        if case.recommendation is None:
            if request is None:
                raise ValidationFailure(
                    "No agent recommendation; supply an action and reason"
                )
            case.recommendation = Recommendation(
                action=request.action,
                reason=request.reason,
                source=RecommendationSource.MANUAL,
            )
        elif request is not None:
            raise ValidationFailure(
                "The agent recommendation is confirmed as is; omit the request body"
            )
        recommendation = case.recommendation
        case.confirmed_by = actor
        events: list[EventData] = [
            (
                "recommendation_confirmed",
                {
                    "action": recommendation.action.value,
                    "source": recommendation.source.value,
                },
            )
        ]
        if recommendation.action == Action.REJECT:
            events.append(transition(case, CaseStatus.REJECTED))
        elif recommendation.action == Action.POST:
            case.package = PostingPackage(
                case_id=case.id,
                invoice=case.invoice,
                gross=case.invoice.net + case.invoice.vat,
            )
            events.append(("package_created", case.package.model_dump(mode="json")))
            events.append(transition(case, CaseStatus.AWAITING_APPROVAL))
        else:
            events.append(transition(case, CaseStatus.WAITING_EXTERNAL))
        return await self.save(case, actor, events)

    async def approve(self, case_id: str, actor: str) -> Case:
        case = await self.get(case_id)
        require_status(case, CaseStatus.AWAITING_APPROVAL)
        if actor == case.confirmed_by:
            raise SamePersonApproval("Approver must differ from the confirmer")
        if case.package is None or not case.confirmed_by:
            raise ValidationFailure("A confirmed posting package is required")
        case.approved_by = actor
        case.package_hash = package_hash(case.package)
        return await self.save(
            case,
            actor,
            [
                ("package_approved", {"hash": case.package_hash}),
                transition(case, CaseStatus.READY_TO_POST),
            ],
        )

    async def reject(self, case_id: str, request: RejectRequest, actor: str) -> Case:
        case = await self.get(case_id)
        return await self.save(
            case,
            actor,
            [
                ("case_rejected", {"reason": request.reason}),
                transition(case, CaseStatus.REJECTED),
            ],
        )

    async def resume(self, case_id: str, actor: str) -> Case:
        case = await self.get(case_id)
        require_status(case, CaseStatus.WAITING_EXTERNAL)
        events = [("case_resumed", {}), transition(case, CaseStatus.EXTRACTED)]
        return await self._decide(case, actor, events)

    async def inform(self, case_id: str, request: InformRequest, actor: str) -> Case:
        case = await self.get(case_id)
        require_status(case, CaseStatus.RECONCILED)
        case.notification_reference = request.reference
        return await self.save(
            case,
            actor,
            [
                ("vendor_informed", request.model_dump()),
                transition(case, CaseStatus.INFORMED),
            ],
        )

    async def document(self, case_id: str) -> tuple[bytes, str]:
        case = await self.get(case_id)
        if case.document is None:
            raise NotFound("Case has no original document")
        try:
            data = await asyncio.to_thread(self._document_path(case.id).read_bytes)
        except OSError as exc:
            raise StorageFailure("Original document cannot be read") from exc
        if hashlib.sha256(data).hexdigest() != case.document.sha256:
            raise StorageFailure("Original document integrity check failed")
        return data, case.document.filename

    async def list(
        self, status: CaseStatus | None, limit: int, offset: int
    ) -> CaseList:
        return await asyncio.to_thread(self.repository.list, status, limit, offset)

    async def events(
        self, case_id: str | None, after_id: int, limit: int
    ) -> list[AuditEvent]:
        if case_id is not None:
            await self.get(case_id)
        return await asyncio.to_thread(self.repository.events, case_id, after_id, limit)

    async def dashboard(self) -> Dashboard:
        return await asyncio.to_thread(self.repository.dashboard)
