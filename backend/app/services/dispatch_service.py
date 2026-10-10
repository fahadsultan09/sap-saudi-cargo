from __future__ import annotations

from ..clients.sap import SAPClient
from ..config import Settings
from ..enums import CaseStatus
from ..errors import (
    AppError,
    DuplicatePost,
    InvalidTransition,
    PackageHashMismatch,
    SamePersonApproval,
    SapPostingRejected,
    ValidationFailure,
)
from ..repository import EventData
from ..schemas import Case, PostRequest
from ..state import require_status, transition
from ..utils import package_hash, utc_now
from .case_service import CaseService

POSTING_STATES = {
    CaseStatus.POSTING,
    CaseStatus.POST_UNKNOWN,
    CaseStatus.POST_FAILED,
    CaseStatus.POSTED,
    CaseStatus.RECONCILIATION_FAILED,
    CaseStatus.RECONCILED,
    CaseStatus.INFORMED,
}


class DispatchService:
    def __init__(self, cases: CaseService, sap: SAPClient, settings: Settings) -> None:
        self.cases = cases
        self.sap = sap
        self.settings = settings

    async def post(self, case_id: str, request: PostRequest, actor: str) -> Case:
        case = await self.cases.get(case_id)
        if case.status in POSTING_STATES or case.idempotency_key is not None:
            raise DuplicatePost("A second posting attempt is refused")
        require_status(case, CaseStatus.READY_TO_POST)
        if (
            not case.approved_by
            or not case.confirmed_by
            or case.approved_by == case.confirmed_by
        ):
            raise SamePersonApproval(
                "Independent confirmation and approval are required"
            )
        if (
            case.package is None
            or case.package_hash is None
            or package_hash(case.package) != case.package_hash
            or request.package_hash != case.package_hash
        ):
            raise PackageHashMismatch("Approved package hash does not match")
        case.idempotency_key = request.idempotency_key
        await self.cases.save(
            case,
            actor,
            [
                ("dispatch_claimed", {"idempotency_key": request.idempotency_key}),
                transition(case, CaseStatus.POSTING),
            ],
            request.idempotency_key,
        )
        try:
            document = await self.sap.post(case.package, request.idempotency_key)
        except SapPostingRejected as exc:
            await self.cases.save(
                case,
                actor,
                [
                    ("sap_posting_rejected", {"code": exc.code}),
                    transition(case, CaseStatus.POST_FAILED),
                ],
            )
            raise
        except Exception as exc:
            # Preserve the claim until SAP lookup establishes the actual outcome.
            await self.cases.save(
                case,
                actor,
                [
                    (
                        "posting_outcome_unknown",
                        {
                            "code": exc.code
                            if isinstance(exc, AppError)
                            else "internal_error",
                        },
                    ),
                    transition(case, CaseStatus.POST_UNKNOWN),
                ],
            )
            raise
        case.sap_document_id = document.id
        return await self.cases.save(
            case,
            actor,
            [
                ("sap_posted", {"document_id": document.id}),
                transition(case, CaseStatus.POSTED),
            ],
        )

    async def reconcile(self, case_id: str, actor: str) -> Case:
        case = await self.cases.get(case_id)
        require_status(case, CaseStatus.POSTED, CaseStatus.RECONCILIATION_FAILED)
        if case.package is None or case.sap_document_id is None:
            raise ValidationFailure("Posted document and approved package are required")
        if package_hash(case.package) != case.package_hash:
            raise PackageHashMismatch("Frozen approved package was modified")
        document = await self.sap.document(case.sap_document_id)
        expected = case.package.model_dump()
        actual = document.package.model_dump()
        differences = [
            key for key in ("case_id", "gross") if expected[key] != actual[key]
        ]
        differences.extend(
            f"invoice.{key}"
            for key in expected["invoice"]
            if expected["invoice"][key] != actual["invoice"][key]
        )
        case.reconciliation_differences = differences
        target = (
            CaseStatus.RECONCILIATION_FAILED if differences else CaseStatus.RECONCILED
        )
        events: list[EventData] = [
            ("sap_reconciled", {"document_id": document.id, "differences": differences})
        ]
        if target != case.status:
            events.append(transition(case, target))
        return await self.cases.save(case, actor, events)

    async def resolve(self, case_id: str, actor: str) -> Case:
        case = await self.cases.get(case_id)
        require_status(case, CaseStatus.POST_UNKNOWN, CaseStatus.POSTING)
        # The age guard keeps recently claimed posts out of recovery.
        if case.status == CaseStatus.POSTING:
            age = (utc_now() - case.updated_at).total_seconds()
            if age <= self.settings.posting_stale_seconds:
                raise InvalidTransition("Posting is not stale enough to resolve")
        if case.idempotency_key is None:
            raise ValidationFailure(
                "A dispatch idempotency key is required for resolution"
            )
        document = await self.sap.find_posting(case.idempotency_key)
        if document is not None:
            case.sap_document_id = document.id
            return await self.cases.save(
                case,
                actor,
                [
                    ("post_resolved_posted", {"document_id": document.id}),
                    transition(case, CaseStatus.POSTED),
                ],
            )
        case.idempotency_key = None
        return await self.cases.save(
            case,
            actor,
            [
                ("post_resolved_not_posted", {}),
                transition(case, CaseStatus.READY_TO_POST),
            ],
            release_claim=True,
        )
