import asyncio
import json
import logging
from collections.abc import AsyncIterator
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse

from ..config import AGENT_MODE
from ..workflow import build_agent_run

router = APIRouter(prefix="/internal/v1", tags=["Internal Processing"])
logger = logging.getLogger("sacc_agents")


@router.post("/process-document")
async def process_document(
    file: UploadFile = File(...),
    file_name: str = Form(...),
    stream: bool = Form(False),
):
    """Run the agents on one PDF for AP Core's worker.

    stream=true answers with one JSON line per finished step ({"type": "step"}) and SAP data
    check ({"type": "check"}) as they happen, then {"type": "result", ...} with the same content
    as the normal response, or {"type": "error", "detail": ...}.
    """
    if AGENT_MODE == "disabled":
        raise HTTPException(503, "Agent processing is disabled")
    if not file_name.lower().endswith(".pdf"):
        raise HTTPException(415, "Only PDF invoices are supported")

    temp_dir = TemporaryDirectory(prefix="ap-process-")
    try:
        pdf_path = await _save_pdf(file, Path(temp_dir.name))
    except HTTPException:
        temp_dir.cleanup()
        raise
    finally:
        await file.close()

    # Built per request, with the context that also runs VECTOR (PO match), SOURCE_CHECK and PRISM.
    orchestrator, extended_context = build_agent_run()
    if stream:
        return StreamingResponse(
            _progress_stream(orchestrator, extended_context, pdf_path, file_name, temp_dir),
            media_type="application/x-ndjson",
        )
    try:
        result = await run_in_threadpool(
            orchestrator.run, pdf_path, file_name, extended_context=extended_context
        )
        return _response(result)
    except Exception as exc:
        logger.exception("Document processing failed for %s", file_name)
        raise HTTPException(
            status_code=502,
            detail=f"Document processing failed: {type(exc).__name__}",
        ) from exc
    finally:
        temp_dir.cleanup()


async def _save_pdf(file: UploadFile, folder: Path) -> Path:
    pdf_path = folder / "invoice.pdf"
    size = 0
    with pdf_path.open("wb") as output:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > 25 * 1024 * 1024:
                raise HTTPException(413, "PDF exceeds 25 MiB")
            output.write(chunk)
    with pdf_path.open("rb") as source:
        if source.read(5) != b"%PDF-":
            raise HTTPException(415, "Invalid PDF signature")
    return pdf_path


async def _progress_stream(orchestrator: Any, extended_context: dict[str, Any] | None, pdf_path: Path,
                           file_name: str, temp_dir: TemporaryDirectory) -> AsyncIterator[str]:
    """Runs the agents in a thread and yields their progress events as JSON lines."""
    events: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def emit(event: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(events.put_nowait, event)

    def work() -> None:
        try:
            result = orchestrator.run(
                pdf_path, file_name, extended_context=extended_context, on_progress=emit
            )
            emit({"type": "result", **_response(result)})
        except Exception as exc:
            logger.exception("Document processing failed for %s", file_name)
            emit({"type": "error", "detail": f"Document processing failed: {type(exc).__name__}"})

    task = loop.run_in_executor(None, work)
    try:
        while True:
            event = await events.get()
            yield json.dumps(jsonable_encoder(event)) + "\n"
            if event["type"] in {"result", "error"}:
                break
    finally:
        await task
        temp_dir.cleanup()


def _response(result: Any) -> dict[str, Any]:
    converted = result.extraction.get("converted", {})
    invoice = converted.get("invoice_source", {})

    # Invoices rarely print the company code; as in SAP, it then comes from the matched PO.
    verdict = result.validation.get("source_verdict") or {}
    po_company_code = next(
        (row["sap"] for row in verdict.get("comparisons", [])
         if row["check"] == "company_code" and row["result"] == "NOT_ON_INVOICE"),
        None,
    )

    # AP Core's schema is deliberately explicit.
    fields = {
        "invoice_number": invoice.get("invoice_number") or None,
        "invoice_date": invoice.get("invoice_date") or None,
        "supplier_name": invoice.get("supplier_name") or None,
        "supplier_id": invoice.get("vendor_number") or None,
        "company_code": invoice.get("company_code") or po_company_code or None,
        "currency": invoice.get("currency") or None,
        "total_amount": invoice.get("total_amount") or None,
        "po_number": invoice.get("po_number") or None,
        "company_name": invoice.get("company_name") or None,
        "net_amount": invoice.get("net_amount") or None,
        "tax_amount": invoice.get("tax_amount") or None,
        "line_items": converted.get("line_items", []),
        "document_type": result.classification.get("document_type"),
    }

    return {
        "classification": result.classification,
        "extraction": result.extraction,
        "extraction_status": result.extraction.get("status"),
        "fields": fields,
        "validation": result.validation,
        "triage": result.triage,

        # Agent results exposed to the UI
        "matching": result.matching,
        "investigation": result.investigation,
        "reconciliation": result.reconciliation,

        "agent_trace": [
            entry.model_dump()
            for entry in result.agent_trace
        ],
    }
