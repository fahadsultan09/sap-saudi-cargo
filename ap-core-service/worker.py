
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

from integration.ap_core_client import APCoreClient

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ap-worker")

WORKER_ID = os.getenv("AP_WORKER_ID", "local-ap-worker")

AGENTIC_AI_URL = os.getenv("AGENTIC_AI_URL", "http://127.0.0.1:8001").rstrip("/")

DB_PATH = Path(
    os.getenv("AP_CORE_DB_PATH", "./runtime_data/ap_core.sqlite3")
).resolve()
DOCUMENTS_DIR = DB_PATH.parent / "documents"


def process_with_progress(client: APCoreClient, case_id: str, pdf_path: Path, file_name: str) -> dict:
    """Send the PDF to the agents and pass each finished step on to AP Core while they run,
    so the review screen moves live. Returns the agents' final result."""
    agent_trace: list[dict] = []
    source_checks: list[dict] = []
    with pdf_path.open("rb") as pdf, httpx.stream(
        "POST",
        f"{AGENTIC_AI_URL}/internal/v1/process-document",
        data={"file_name": file_name, "stream": "true"},
        files={"file": (file_name, pdf, "application/pdf")},
        timeout=300,
    ) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            if not line:
                continue
            event = json.loads(line)
            if event["type"] == "result":
                return event
            if event["type"] == "error":
                raise RuntimeError(event["detail"])
            if event["type"] == "step":
                agent_trace.append(event["step"])
            else:
                source_checks.append(event["check"])
            try:
                client.submit_progress(case_id, agent_trace=agent_trace, source_checks=source_checks)
            except httpx.HTTPError:
                # Progress is only for display; processing goes on without it.
                logger.warning("Could not report progress for case %s", case_id)
    raise RuntimeError("Agentic AI stream ended without a result")


def process_once() -> bool:
    client = APCoreClient()

    try:
        lease = client.lease_work(
            worker_id=WORKER_ID,
            task_types=["PROCESS_DOCUMENT"],
            lease_seconds=300,
        )

        item = lease.get("work_item")
        if not item:
            return False

        work_id = item["id"]
        case_id = item["case_id"]
        attempt = item["attempt"]
        payload = item.get("payload") or {}
        document_ref = payload.get("document_ref")
        file_name = payload.get("file_name") or "invoice.pdf"

        try:
            if (
                not document_ref
                or Path(document_ref).name != document_ref
            ):
                raise ValueError("Missing or invalid document_ref")

            pdf_path = DOCUMENTS_DIR / document_ref

            if not pdf_path.is_file():
                raise FileNotFoundError(
                    f"Stored PDF not found: {pdf_path}"
                )

            logger.info("Processing case %s", case_id)

            result = process_with_progress(client, case_id, pdf_path, file_name)

            fields = result.get("fields")
            if not isinstance(fields, dict):
                raise ValueError("Invalid fields in Agentic AI response")

            saved = client.submit_extraction(
                case_id,
                fields=fields,
                validation=result.get("validation") or {},
                idempotency_key=f"extract:{case_id}:{work_id}",
            )

            client.complete_work(
                work_id,
                worker_id=WORKER_ID,
                outcome="SUCCEEDED",
                idempotency_key=f"complete:{work_id}:{attempt}",
                result={"ap_core_result": saved},
            )

            logger.info("Case %s processed: %s", case_id, saved)
            return True

        except Exception as exc:
            logger.exception("Processing failed for case %s", case_id)

            outcome = "RETRY" if attempt < 5 else "FAILED"

            try:
                client.complete_work(
                    work_id,
                    worker_id=WORKER_ID,
                    outcome=outcome,
                    idempotency_key=f"complete:{work_id}:{attempt}",
                    error=f"{type(exc).__name__}: {str(exc)[:500]}",
                )
            except Exception:
                logger.exception("Failed to report work-item outcome")

            return True

    finally:
        client.close()


if __name__ == "__main__":
    while True:
        try:
            if not process_once():
                time.sleep(60)
        except Exception:
            logger.exception("Worker loop error")
            time.sleep(5)
