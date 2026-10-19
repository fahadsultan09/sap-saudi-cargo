from __future__ import annotations

import uuid
from typing import Any

from ..database import audit
from ..schemas import Actor


def audit_event(
    conn,
    case_id: str,
    event_type: str,
    actor: Actor,
    *,
    reason: str = "",
    before: Any = None,
    after: Any = None,
    metadata: Any = None,
    correlation_id: str | None = None,
) -> None:
    audit(
        conn,
        event_id=str(uuid.uuid4()),
        case_id=case_id,
        event_type=event_type,
        actor_id=actor.user_id,
        actor_role=actor.role,
        reason=reason,
        before=before,
        after=after,
        metadata=metadata,
        correlation_id=correlation_id,
    )
