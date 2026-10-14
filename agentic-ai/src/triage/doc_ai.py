"""SAP Document AI (DOX) extraction client for the triage pipeline.

This module handles detailed field extraction from invoices using SAP
Document Information Extraction (DOX). It is called AFTER SAP AI Core
has classified the document as an invoice.

This module handles:
    1. OAuth2 client-credentials authentication
       from SAP Document AI service-key JSON
    2. Finding the invoice extraction schema
    3. Uploading a document and polling for extraction completion
    4. Converting DOX results (headerFields/lineItems)
       to DocumentEntity format
    5. Convenience function ``run_triage_with_doc_ai()``
       that processes a file and runs the full triage pipeline

Authentication:
    Credentials are loaded from an SAP Document AI service-key JSON file.

Expected service-key structure:

{
    "uaa": {
        "url": "https://...authentication.in30.hana.ondemand.com",
        "clientid": "...",
        "clientsecret": "..."
    },
    "url": "https://in30.doc.cloud.sap"
}

Default location:
    config/sap_credentials.json

Override with:
    --cred-file CLI argument

Dependencies:
    requests
    python-dotenv (not required unless other project code uses it)

Usage (programmatic):

    from triage.doc_ai import run_triage_with_doc_ai

    result = run_triage_with_doc_ai("path/to/invoice.pdf")
    print(json.dumps(result, indent=2))

Usage (CLI):

    python -m triage.doc_ai path/to/invoice.pdf

    python -m triage.doc_ai path/to/invoice.pdf \
        --cred-file config/sap_credentials.json
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from typing import Any, Optional

import requests

from .config import SAP_DOX_SCHEMA_ID
from .runner import run_triage


logger = logging.getLogger("triage_doc_ai")


# ── Constants ───────────────────────────────────────────────────────────────

POLL_INTERVAL_SEC = 5
POLL_TIMEOUT_SEC = 300

DOX_API_VERSION = "document-information-extraction/v1"


# ── Credential resolution ──────────────────────────────────────────────────


def _load_cred_file(cred_file: str) -> dict[str, str]:
    """Load an SAP Document AI service-key JSON file.

    Expected structure:

        {
            "uaa": {
                "url": "...",
                "clientid": "...",
                "clientsecret": "..."
            },
            "url": "https://in30.doc.cloud.sap"
        }

    Returns:
        Dictionary containing:
            uaa_url
            client_id
            client_secret
            dox_url
    """

    if not os.path.isfile(cred_file):
        raise FileNotFoundError(
            f"SAP Document AI credentials file not found: {cred_file}"
        )

    with open(cred_file, encoding="utf-8") as f:
        cred = json.load(f)

    if "uaa" not in cred:
        raise ValueError(
            "Invalid SAP Document AI credentials file: "
            "missing 'uaa' section."
        )

    uaa = cred["uaa"]

    required_uaa_fields = [
        "url",
        "clientid",
        "clientsecret",
    ]

    missing_uaa_fields = [
        field
        for field in required_uaa_fields
        if not uaa.get(field)
    ]

    if missing_uaa_fields:
        raise ValueError(
            "Invalid SAP Document AI credentials file: "
            f"missing UAA fields: {', '.join(missing_uaa_fields)}"
        )

    if not cred.get("url"):
        raise ValueError(
            "Invalid SAP Document AI credentials file: "
            "missing top-level 'url'."
        )

    return {
        "uaa_url": uaa["url"].rstrip("/"),
        "client_id": uaa["clientid"],
        "client_secret": uaa["clientsecret"],
        "dox_url": cred["url"].rstrip("/"),
    }


def _resolve_credentials(
    cred_file: Optional[str] = None,
) -> dict[str, str]:
    """Resolve SAP Document AI credentials.

    Priority:
        1. Explicit ``cred_file`` argument
        2. SAP_DOC_AI_CREDENTIALS_FILE environment variable
        3. config/sap_credentials.json at project root
    """

    # doc_ai.py:
    # project_root/
    # ├── config/
    # │   └── sap_credentials.json
    # └── src/
    #     └── triage/
    #         └── doc_ai.py
    #
    # Go up:
    # doc_ai.py -> triage -> src -> project_root

    project_root = os.path.dirname(
        os.path.dirname(
            os.path.dirname(
                os.path.abspath(__file__)
            )
        )
    )

    default_cred_file = os.path.join(
        project_root,
        "config",
        "sap_credentials.json",
    )

    cred_file = (
        cred_file
        or os.getenv("SAP_DOC_AI_CREDENTIALS_FILE")
        or default_cred_file
    )

    logger.info(
        "Loading SAP Document AI credentials from %s",
        cred_file,
    )

    return _load_cred_file(cred_file)

# ── Header field / line item conversion helpers ────────────────────────────


def _convert_sap_header_fields(
    fields: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Convert SAP DOX headerFields to the pipeline's DocumentEntity format."""

    entities: list[dict[str, Any]] = []

    for field in fields:

        name = field.get("name")

        if not name:
            continue

        value = field.get("value", "")

        confidence = float(
            field.get("confidence") or 0.0
        )

        entity: dict[str, Any] = {
            "name": name,
            "confidence": confidence,
        }

        if isinstance(value, bool):

            entity["type"] = "string"
            entity["stringValue"] = str(value)

        elif isinstance(value, (int, float)):

            entity["type"] = "number"
            entity["numberValue"] = value

        else:

            entity["type"] = "string"
            entity["stringValue"] = (
                str(value)
                if value is not None
                else ""
            )

        entities.append(entity)

    return entities


def _convert_sap_line_item(
    item: dict[str, Any] | list[dict[str, Any]],
) -> dict[str, Any]:
    """Convert a SAP DOX line item to the pipeline's line-item format.

    Handles two SAP DOX response formats:
    - A list of field objects (standard DOX API):
      [{"name": "description", "value": "...", "confidence": 0.95}, ...]
    - A dict with named keys (alternative format):
      {"description": "...", "quantity": "...", ...}
    """

    # SAP DOX returns each line item row as a list of
    # {name, value, confidence} field objects.
    # Flatten into a dict keyed by field name.
    if isinstance(item, list):
        flat: dict[str, Any] = {}
        confidences: list[float] = []
        for field in item:
            if not isinstance(field, dict):
                continue
            name = field.get("name")
            if name:
                flat[name] = field.get("value")
            if field.get("confidence") is not None:
                confidences.append(float(field["confidence"]))
        item = flat
        confidence = (
            sum(confidences) / len(confidences)
            if confidences
            else 0.0
        )
    else:
        confidence = float(item.get("confidence") or 0.0)

    return {
        "description": item.get(
            "description",
            item.get("itemDescription", ""),
        ),
        "quantity": item.get("quantity"),
        "unit_price": item.get("unitPrice"),
        "total_amount": (
            item.get("totalAmount")
            or item.get("amount")
            or item.get("netAmount")
        ),
        "item_number": item.get(
            "itemNumber",
            "",
        ),
        "gl_account": item.get(
            "glAccount",
            "",
        ),
        "cost_center": item.get(
            "costCenter",
            "",
        ),
        "tax_code": item.get(
            "taxCode",
            "",
        ),
        "confidence": confidence,
    }


# ── Document AI Client ─────────────────────────────────────────────────────


class DocAIClient:
    """Client for SAP Document Information Extraction (DOX).

    Authenticates with SAP Document AI, finds the invoice extraction
    schema, uploads documents, polls for completion, and returns
    extraction results.
    """

    def __init__(
        self,
        cred_file: Optional[str] = None,
    ) -> None:

        cred = _resolve_credentials(
            cred_file
        )

        self.uaa_url = cred["uaa_url"]
        self.client_id = cred["client_id"]
        self.client_secret = cred["client_secret"]

        # Example:
        # https://in30.doc.cloud.sap
        self.dox_url = cred["dox_url"].rstrip("/")

        # Correct SAP Document AI API base:
        #
        # https://in30.doc.cloud.sap/
        # document-information-extraction/v1
        #
        self.base_url = (
            f"{self.dox_url}/{DOX_API_VERSION}"
        )

        self._token: Optional[str] = None
        self._token_expires: float = 0

        logger.info(
            "SAP Document AI base URL: %s",
            self.base_url,
        )

    # ── Authentication ─────────────────────────────────────────────────

    def _get_token(self) -> str:
        """Get an OAuth2 access token using client credentials."""

        # Reuse token if it has not expired.
        if (
            self._token
            and time.time() < self._token_expires
        ):
            return self._token

        logger.info(
            "Authenticating with SAP Document AI UAA: %s",
            self.uaa_url,
        )

        response = requests.post(
            f"{self.uaa_url}/oauth/token",
            data={
                "grant_type": "client_credentials",
            },
            auth=(
                self.client_id,
                self.client_secret,
            ),
            timeout=30,
        )

        response.raise_for_status()

        token_data = response.json()

        self._token = token_data["access_token"]

        # Use expires_in when available.
        # Keep 60 seconds as a safety margin.
        expires_in = int(
            token_data.get(
                "expires_in",
                3600,
            )
        )

        self._token_expires = (
            time.time()
            + max(expires_in - 60, 60)
        )

        logger.info(
            "SAP Document AI authentication successful."
        )

        return self._token

    def _headers(self) -> dict[str, str]:
        """Build authenticated HTTP headers."""

        return {
            "Authorization": (
                f"Bearer {self._get_token()}"
            ),
            "Accept": "application/json",
        }

    # ── Schema discovery ───────────────────────────────────────────────

    def find_schema(
        self,
        name: str = "invoice",
    ) -> Optional[str]:
        """Find a DOX extraction schema by document type.

        Returns:
            Schema ID if found, otherwise None.
        """

        response = requests.get(
            f"{self.base_url}/schemas",
            headers=self._headers(),
            params={
                "clientId": "default",
            },
            timeout=30,
        )

        response.raise_for_status()

        data = response.json()

        schemas = data.get(
            "schemas",
            data.get(
                "payload",
                [],
            ),
        )

        matching = [
            schema
            for schema in schemas
            if schema.get("documentType") == name
        ]

        if matching:

            schema = matching[0]

            logger.info(
                "Found invoice schema: %s (id=%s)",
                schema.get("name"),
                schema.get("id"),
            )

            return schema.get("id")

        logger.warning(
            "Schema with documentType='%s' "
            "not found among %d schemas.",
            name,
            len(schemas),
        )

        return None

    # ── Upload + poll ──────────────────────────────────────────────────

    def upload_and_process(
        self,
        file_path: str,
        schema_id: Optional[str] = None,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        """Upload a document to SAP Document AI and poll until completion."""

        if not os.path.isfile(file_path):
            raise FileNotFoundError(
                f"Document file not found: {file_path}"
            )

        # First use explicitly supplied schema ID.
        #
        # Then use SAP_DOX_SCHEMA_ID from config.
        #
        # Finally discover invoice schema automatically.
        if not schema_id:
            schema_id = (
                SAP_DOX_SCHEMA_ID
                or None
            )

        if not schema_id:

            schema_id = self.find_schema(
                "invoice"
            )

            if not schema_id:
                raise RuntimeError(
                    "No invoice schema found in SAP Document AI.\n"
                    "Set SAP_DOX_SCHEMA_ID in your configuration "
                    "or make sure the schema lookup API is available."
                )

        file_name = os.path.basename(
            file_path
        )

        # Same options structure as your working
        # SAP Document AI sample.
        options = {
            "clientId": "default",
            "documentType": "invoice",
            "enrichment": {
                "sender": {
                    "top": 5,
                    "type": "businessEntity",
                    "subtype": "supplier",
                },
                "employee": {
                    "type": "employee",
                },
            },
        }

        if schema_id:
            options["schemaId"] = schema_id

        # Determine MIME type.
        lower_name = file_name.lower()

        if lower_name.endswith(".pdf"):
            content_type = "application/pdf"

        elif lower_name.endswith(".png"):
            content_type = "image/png"

        elif lower_name.endswith(
            (".jpg", ".jpeg")
        ):
            content_type = "image/jpeg"

        else:
            content_type = (
                "application/octet-stream"
            )

        logger.info(
            "Uploading document to SAP Document AI: %s",
            file_name,
        )

        with open(
            file_path,
            "rb",
        ) as file_handle:

            response = requests.post(
                f"{self.base_url}/document/jobs",
                headers=self._headers(),
                files={
                    "file": (
                        file_name,
                        file_handle,
                        content_type,
                    )
                },
                data={
                    "options": json.dumps(
                        options
                    )
                },
                timeout=120,
            )

        logger.info(
            "Document submission status: %s",
            response.status_code,
        )

        if not response.ok:
            logger.error(
                "SAP Document AI submission failed: %s",
                response.text,
            )

        response.raise_for_status()

        job = response.json()

        job_id = job.get("id")

        if not job_id:
            raise RuntimeError(
                "SAP Document AI submission succeeded "
                "but no job ID was returned.\n"
                f"Response: {job}"
            )

        logger.info(
            "SAP Document AI job created: %s",
            job_id,
        )

        # ── Poll for completion ───────────────────────────────────────

        start_time = time.time()

        while True:

            response = requests.get(
                f"{self.base_url}/document/jobs/{job_id}",
                headers=self._headers(),
                params={
                    "returnNullValues": "true",
                },
                timeout=30,
            )

            response.raise_for_status()

            job = response.json()

            status = job.get(
                "status",
                "",
            )

            logger.info(
                "Job %s status: %s",
                job_id,
                status,
            )

            if status in (
                "DONE",
                "COMPLETED",
                "FAILED",
            ):
                break

            if (
                time.time() - start_time
                > POLL_TIMEOUT_SEC
            ):
                raise TimeoutError(
                    f"SAP Document AI job {job_id} "
                    f"timed out after "
                    f"{POLL_TIMEOUT_SEC} seconds."
                )

            time.sleep(
                POLL_INTERVAL_SEC
            )

        if status == "FAILED":

            raise RuntimeError(
                f"SAP Document AI extraction failed "
                f"for job {job_id}."
            )

        logger.info(
            "SAP Document AI extraction completed for %s",
            file_name,
        )

        return job

    # ── Result conversion ──────────────────────────────────────────────

    @staticmethod
    def convert_results(
        job_response: dict[str, Any],
    ) -> dict[str, Any]:
        """Convert DOX extraction results to the pipeline format."""

        extraction = job_response.get(
            "extraction",
            {},
        )

        header_fields = extraction.get(
            "headerFields",
            [],
        )

        line_items_raw = extraction.get(
            "lineItems",
            [],
        )

        entities = _convert_sap_header_fields(
            header_fields
        )

        line_items = [
            li for li in (_convert_sap_line_item(item) for item in line_items_raw)
            if any(li.get(k) for k in ("description", "quantity", "unit_price"))
        ]

        # Build invoice_source from header fields.
        values: dict[str, str] = {}

        for entity in entities:

            value = (
                entity.get("stringValue")
                or str(
                    entity.get(
                        "numberValue",
                        "",
                    )
                    or ""
                )
            )

            if value:
                values[
                    entity["name"]
                ] = str(value)

        invoice_source = {
            "file_name": job_response.get(
                "fileName",
                "",
            )
        }

        field_mapping = {
            "invoice_number": [
                "invoice_number",
                "documentNumber",
            ],
            "invoice_date": [
                "invoice_date",
                "documentDate",
            ],
            "supplier_name": [
                "supplier_name",
                "senderName",
            ],
            "company_name": [
                "company_name",
                "receiverName",
            ],
            "company_code": [
                "company_code",
            ],
            "total_amount": [
                "total_amount",
                "grossAmount",
            ],
            "currency": [
                "currency",
                "currencyCode",
            ],
            "net_amount": [
                "net_amount",
                "netAmount",
            ],
            "tax_amount": [
                "tax_amount",
            ],
            "po_number": [
                "po_number",
                "purchaseOrderNumber",
            ],
            "vendor_number": [
                "vendor_number",
                "vendorNumber",
            ],
        }

        for key, alternative_keys in (
            field_mapping.items()
        ):

            for alternative_key in alternative_keys:

                if alternative_key in values:

                    invoice_source[key] = (
                        values[alternative_key]
                    )

                    break

            else:
                invoice_source[key] = ""

        return {
            "classification_extraction": entities,
            "detailed_extraction": entities,
            "invoice_source": invoice_source,
            "line_items": line_items,
        }


# ── Convenience function ───────────────────────────────────────────────────


def run_triage_with_doc_ai(
    file_path: str,
    *,
    cred_file: Optional[str] = None,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Process a document through SAP Document AI and triage."""

    # 1. Create Document AI client.
    client = DocAIClient(
        cred_file=cred_file
    )

    # 2. Authenticate, find schema,
    #    upload document and poll.
    job = client.upload_and_process(
        file_path=file_path
    )

    # 3. Convert DOX results.
    converted = (
        DocAIClient.convert_results(
            job
        )
    )

    logger.info(
        "Extraction results: %d header fields, "
        "%d line items",
        len(
            converted[
                "classification_extraction"
            ]
        ),
        len(
            converted[
                "line_items"
            ]
        ),
    )

    # 4. Run existing triage pipeline.
    result = run_triage(
        classification_extraction=converted[
            "classification_extraction"
        ],
        detailed_extraction=converted[
            "detailed_extraction"
        ],
        line_items=(
            converted["line_items"]
            or None
        ),
        file_name=converted[
            "invoice_source"
        ].get(
            "file_name",
            os.path.basename(
                file_path
            ),
        ),
    )

    # 5. Add SAP Document AI metadata.
    result["sap_doc_ai"] = {
        "job_id": job.get(
            "id",
            "",
        ),
        "status": job.get(
            "status",
            "",
        ),
    }

    return result


# ── CLI Entry Point ────────────────────────────────────────────────────────


def main() -> None:
    """CLI entry point for SAP Document AI triage."""

    parser = argparse.ArgumentParser(
        description=(
            "Extract and triage a document "
            "using SAP Document AI."
        )
    )

    parser.add_argument(
        "file_path",
        help=(
            "Path to the document file "
            "(PDF, PNG, JPG, etc.)"
        ),
    )

    parser.add_argument(
        "--cred-file",
        default=None,
        help=(
            "Path to SAP Document AI "
            "service-key JSON file. "
            "Defaults to "
            "config/sap_credentials.json"
        ),
    )

    args = parser.parse_args()

    if not os.path.isfile(
        args.file_path
    ):
        print(
            f"ERROR: File not found: "
            f"{args.file_path}"
        )
        sys.exit(1)

    try:

        result = run_triage_with_doc_ai(
            file_path=args.file_path,
            cred_file=args.cred_file,
        )

    except Exception as exc:

        logger.exception(
            "SAP Document AI processing failed."
        )

        print(
            f"\nERROR: {exc}"
        )

        sys.exit(1)

    print(
        "\n" + "=" * 60
    )

    print(
        "  TRIAGE RESULT "
        "(via SAP Document AI)"
    )

    print(
        "=" * 60
    )

    print(
        json.dumps(
            result,
            indent=2,
            default=str,
        )
    )

    print(
        "\n" + "=" * 60
    )

    print(
        "  EVIDENCE TRAIL"
    )

    print(
        "=" * 60
    )

    for i, evidence in enumerate(
        result.get(
            "evidence",
            [],
        ),
        1,
    ):

        print(
            f"  {i:2d}. {evidence}"
        )


if __name__ == "__main__":
    main()
