
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from src.agents.orchestrator import APAgentOrchestrator

router = APIRouter(prefix="/internal/v1", tags=["Internal Processing"])
orchestrator = APAgentOrchestrator()


@router.post("/process-document")
async def process_document(
    file: UploadFile = File(...),
    file_name: str = Form(...),
):
    if not file_name.lower().endswith(".pdf"):
        raise HTTPException(415, "Only PDF invoices are supported")

    with TemporaryDirectory(prefix="ap-process-") as temp_dir:
        pdf_path = Path(temp_dir) / "invoice.pdf"

        try:
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

            result = orchestrator.run(pdf_path, file_name)
            converted = result.extraction.get("converted", {})
            invoice = converted.get("invoice_source", {})

            # AP Core's schema is deliberately explicit.
            fields = {
                "invoice_number": invoice.get("invoice_number") or None,
                "invoice_date": invoice.get("invoice_date") or None,
                "supplier_name": invoice.get("supplier_name") or None,
                "supplier_id": invoice.get("vendor_number") or None,
                "company_code": invoice.get("company_code") or None,
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

        except HTTPException:
            raise
        except Exception as exc:
            import logging
            logging.getLogger("sacc_agents").exception(
                "Document processing failed for %s", file_name
            )
            raise HTTPException(
                status_code=502,
                detail=f"Document processing failed: {type(exc).__name__}",
            ) from exc
        finally:
            await file.close()
