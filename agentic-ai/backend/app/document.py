"""ap-worker-document. Calls SAP Document AI (Document Information Extraction), returns evidence with confidence.
It never decides anything. DOC_AI_MODE=sap uses the real service, DOC_AI_MODE=stub (default) reads a plain-text invoice for local runs."""
import os, json, time, re
from decimal import Decimal, InvalidOperation
import httpx
MIN_CONF = float(os.getenv("DOC_AI_MIN_CONF", "0.80"))
# Document AI header field name -> our field. Check names against your schema in the Swagger UI and override with DOC_AI_FIELD_MAP.
FIELD_MAP = json.loads(os.getenv("DOC_AI_FIELD_MAP", '{"senderName":"vendor_name","documentNumber":"inv_no","netAmount":"net","taxAmount":"vat","purchaseOrderNumber":"po"}'))
class ExtractionError(Exception): pass
def sniff(data: bytes):
    if data[:4] == b"%PDF": return "application/pdf"
    if data[:8] == b"\x89PNG\r\n\x1a\n": return "image/png"
    if data[:3] == b"\xff\xd8\xff": return "image/jpeg"
    if os.getenv("DOC_AI_MODE", "stub") == "stub" and data[:7] == b"Vendor:": return "text/plain"
    return None
def money(v):
    try: return str(Decimal(re.sub(r"[^\d.]", "", str(v))))
    except InvalidOperation: return None
class StubExtractor:
    KEYS = {"vendor": "vendor_name", "invoice no": "inv_no", "net": "net", "vat": "vat", "po": "po"}
    def extract(self, data, filename, mime):
        out = {}
        for line in data.decode(errors="ignore").splitlines():
            if ":" in line:
                k, v = line.split(":", 1); k = k.strip().lower()
                if k in self.KEYS:
                    v = v.strip(); low = v.endswith("?"); out[self.KEYS[k]] = {"value": v.rstrip("?").strip(), "confidence": 0.5 if low else 0.97}
        return out
class SapDocumentAI:
    def __init__(self, transport=None):
        k = json.loads(os.environ["DOC_AI_SERVICE_KEY"])
        self.base = k["url"].rstrip("/") + os.getenv("DOC_AI_BASE_PATH", "/document-information-extraction/v1")
        self.uaa = k["uaa"]; self.http = httpx.Client(transport=transport, timeout=30)
    def _token(self):
        r = self.http.post(self.uaa["url"].rstrip("/") + "/oauth/token", data={"grant_type": "client_credentials"}, auth=(self.uaa["clientid"], self.uaa["clientsecret"]))
        r.raise_for_status(); return r.json()["access_token"]
    def extract(self, data, filename, mime):
        h = {"Authorization": "Bearer " + self._token()}
        opts = {"schemaName": os.getenv("DOC_AI_SCHEMA", "SAP_invoice_schema"), "clientId": os.getenv("DOC_AI_CLIENT", "default"), "documentType": "invoice"}
        r = self.http.post(self.base + "/document/jobs", headers=h, files={"file": (filename, data, mime)}, data={"options": json.dumps(opts)})
        r.raise_for_status(); job = r.json()["id"]
        for _ in range(int(os.getenv("DOC_AI_POLLS", "30"))):
            g = self.http.get(f"{self.base}/document/jobs/{job}", headers=h); g.raise_for_status(); j = g.json()
            if j.get("status") == "DONE":
                hf = (j.get("extraction") or j).get("headerFields", [])
                return {FIELD_MAP[f["name"]]: {"value": f.get("value"), "confidence": float(f.get("confidence") or 0)} for f in hf if f["name"] in FIELD_MAP}
            if j.get("status") == "FAILED": raise ExtractionError("Document AI job failed")
            time.sleep(float(os.getenv("DOC_AI_POLL_SECS", "2")))
        raise ExtractionError("Document AI job timed out")
def get_extractor():
    return SapDocumentAI() if os.getenv("DOC_AI_MODE", "stub") == "sap" else StubExtractor()
