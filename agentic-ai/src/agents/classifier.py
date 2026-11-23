from __future__ import annotations

from pathlib import Path
from typing import Any

from .contracts import ClassificationDecision


class ClassifierTriageAgent:
    """CLASSIFIER: classifies an attachment and recommends the next processing path.

    AI Core does the model inference. This wrapper validates the result and
    never changes case status or makes an approval/posting decision.
    """
    name = "CLASSIFIER"

    def __init__(self, client: Any | None = None):
        self._client = client

    def run(self, file_path: str | Path, file_name: str) -> dict[str, Any]:
        if self._client is None:
            from triage.ai_core import AICoreClient
            client = AICoreClient()
        else:
            client = self._client
        raw = client.upload_and_process(str(file_path), email_metadata={"attachment_name": file_name})
        validated = ClassificationDecision.model_validate(raw)
        return validated.model_dump()
