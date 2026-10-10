from __future__ import annotations

from .enums import CaseStatus as S
from .errors import InvalidTransition
from .schemas import Case

TRANSITIONS: dict[S, set[S]] = {
    S.RECEIVED: {S.EXTRACTED, S.NEEDS_REVIEW, S.REJECTED},
    S.NEEDS_REVIEW: {S.EXTRACTED, S.REJECTED},
    S.EXTRACTED: {S.AWAITING_CONFIRM, S.WAITING_EXTERNAL, S.REJECTED},
    S.WAITING_EXTERNAL: {S.EXTRACTED, S.REJECTED},
    S.AWAITING_CONFIRM: {S.AWAITING_APPROVAL, S.WAITING_EXTERNAL, S.REJECTED},
    S.AWAITING_APPROVAL: {S.READY_TO_POST, S.REJECTED},
    S.READY_TO_POST: {S.POSTING, S.REJECTED},
    S.POSTING: {S.POSTED, S.POST_UNKNOWN, S.POST_FAILED, S.READY_TO_POST},
    S.POST_UNKNOWN: {S.POSTED, S.READY_TO_POST},
    S.POST_FAILED: set(),
    S.POSTED: {S.RECONCILED, S.RECONCILIATION_FAILED},
    S.RECONCILIATION_FAILED: {S.RECONCILED},
    S.RECONCILED: {S.INFORMED},
    S.INFORMED: set(),
    S.REJECTED: set(),
}


def require_status(case: Case, *allowed: S) -> None:
    if case.status not in allowed:
        raise InvalidTransition(f"Operation is not allowed in {case.status}")


def transition(case: Case, target: S) -> tuple[str, dict[str, object]]:
    if target not in TRANSITIONS[case.status]:
        raise InvalidTransition(f"Cannot move from {case.status} to {target}")
    previous = case.status
    case.status = target
    return "status_changed", {"from": previous.value, "to": target.value}
