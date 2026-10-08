"""ap-worker-document. Calls SAP Document AI (Document Information Extraction), returns evidence with confidence.
It never decides anything. DOC_AI_MODE=sap uses the real service, DOC_AI_MODE=stub (default) reads a plain-text invoice for local runs."""
import os, json, time, re
from decimal import Decimal, InvalidOperation
import httpx
import requests



MIN_CONF = float(os.getenv("DOC_AI_MIN_CONF", "0.80"))
# Document AI header field name -> our field. Check names against your schema in the Swagger UI and override with DOC_AI_FIELD_MAP.
FIELD_MAP = json.loads(
    os.getenv(
        "DOC_AI_FIELD_MAP",
        '{"senderName":"vendor_name","documentNumber":"inv_no","netAmount":"net","taxAmount":"vat","purchaseOrderNumber":"po"}',
    )
)


class ExtractionError(Exception):
    pass


def sniff(data: bytes):
    if data[:4] == b"%PDF":
        return "application/pdf"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if os.getenv("DOC_AI_MODE", "stub") == "stub" and data[:7] == b"Vendor:":
        return "text/plain"
    return None


def money(v):
    try:
        return str(Decimal(re.sub(r"[^\d.]", "", str(v))))
    except InvalidOperation:
        return None


class StubExtractor:
    KEYS = {
        "vendor": "vendor_name",
        "invoice no": "inv_no",
        "net": "net",
        "vat": "vat",
        "po": "po",
    }

    def extract(self, data, filename, mime):
        out = {}
        for line in data.decode(errors="ignore").splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                k = k.strip().lower()
                if k in self.KEYS:
                    v = v.strip()
                    low = v.endswith("?")
                    out[self.KEYS[k]] = {
                        "value": v.rstrip("?").strip(),
                        "confidence": 0.5 if low else 0.97,
                    }
        return out

class ExtractionError(Exception):
    pass


class SapDocumentAI:

    def __init__(self):

        self.http = requests.Session()

        with open(
            os.getenv("DOC_AI_SERVICE_KEY_FILE"),
            "r",
            encoding="utf-8"
        ) as f:
            self.cfg = json.load(f)

        self.base = (
            self.cfg["url"].rstrip("/")
            + self.cfg["resturl"].rstrip("/")
        )

        self.uaa = self.cfg["uaa"]

        print("DOC AI BASE =", self.base)

    def _token(self):

        r = self.http.post(
            self.uaa["url"].rstrip("/") + "/oauth/token",
            data={"grant_type": "client_credentials"},
            auth=(
                self.uaa["clientid"],
                self.uaa["clientsecret"]
            )
        )

        print("TOKEN STATUS =", r.status_code)
        print("TOKEN RESPONSE =", r.text)

        r.raise_for_status()

        return r.json()["access_token"]
    
    def extract(self, data, filename, mime):

        h = {"Authorization": "Bearer " + self._token()}

        opts = {
            "schemaName": os.getenv("DOC_AI_SCHEMA", "SAP_invoice_schema"),
            "clientId": os.getenv("DOC_AI_CLIENT", "default"),
            "documentType": "invoice",
        }

        print("Uploading document to SAP Document AI...")
        print("Schema:", opts["schemaName"])

        r = self.http.post(
            f"{self.base}/document/jobs",
            headers=h,
            files={"file": (filename, data, mime)},
            data={"options": json.dumps(opts)},
        )

        print("CREATE JOB STATUS =", r.status_code)
        print("CREATE JOB RESPONSE =", r.text)

        r.raise_for_status()

        job_json = r.json()

        if "id" not in job_json:
            raise ExtractionError(f"Job creation failed. Response: {job_json}")

        job = job_json["id"]

        print("JOB ID =", job)

        max_polls = int(os.getenv("DOC_AI_POLLS", "30"))

        for i in range(max_polls):

            print(f"Polling SAP Document AI ({i + 1}/{max_polls})...")

            g = self.http.get(f"{self.base}/document/jobs/{job}", headers=h)


            print("POLL RESPONSE =", g.text)
            
            print("POLL STATUS =", g.status_code)

            print("POLL RESPONSE =", g.text)

            g.raise_for_status()

            j = g.json()

            status = j.get("status") or j.get("state") or ""

            print("JOB STATUS =", status)

            # SAP versions differ
            # if status in ("DONE", "SUCCEEDED", "SUCCESS", "COMPLETED"):

            #     extraction = j.get("extraction") or j.get("result") or {}

            #     header_fields = extraction.get("headerFields", [])

            #     print("HEADER FIELDS =", json.dumps(header_fields, indent=2))

            #     result = {}

            #     for field in header_fields:

            #         name = field.get("name")

            #         if name in FIELD_MAP:

            #             result[FIELD_MAP[name]] = {
            #                 "value": field.get("value"),
            #                 "confidence": float(field.get("confidence", 0)),
            #             }

            #     print("FINAL EXTRACTION =", json.dumps(result, indent=2))

            #     return result


            if status in ("DONE", "SUCCEEDED", "SUCCESS", "COMPLETED"):

                # print("FULL SAP RESPONSE")
                # print(json.dumps(j, indent=2))

                extraction = j.get("extraction") or j.get("result") or {}

                # print("EXTRACTION OBJECT")
                # print(json.dumps(extraction, indent=2))

                header_fields = extraction.get("headerFields", [])

                # print("HEADER FIELDS")
                # print(json.dumps(header_fields, indent=2))

                result = {}

                for field in header_fields:

                    # print("FIELD =", field)

                    name = field.get("name")

                    if name in FIELD_MAP:

                        result[FIELD_MAP[name]] = {
                            "value": field.get("value"),
                            "confidence": float(field.get("confidence", 0)),
                        }

                # print("FINAL RESULT")
                # print(json.dumps(result, indent=2))

                return result
            
            
            if status in ("FAILED", "ERROR"):
                raise ExtractionError(f"Document AI job failed: {json.dumps(j)}")

            time.sleep(2)

        raise ExtractionError(
            f"Document AI job {job} timed out after {max_polls} polls"
        )


def get_extractor():
    return (
        SapDocumentAI()
        if os.getenv("DOC_AI_MODE", "stub") == "sap"
        else StubExtractor()
    )
