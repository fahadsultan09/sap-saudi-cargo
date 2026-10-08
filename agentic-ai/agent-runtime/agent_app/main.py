import os, hmac
import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from .loop import investigate
app = FastAPI(title="Agent runtime")
class Req(BaseModel): case: dict; token: str
def get_gateway_http(): return httpx.Client(base_url=os.environ["AP_CORE_URL"], timeout=15)
@app.get("/health")
def health(): return {"ok": True, "mode": os.getenv("AGENT_MODE", "stub")}
@app.post("/v1/investigate")
def run(req: Req, x_service_key: str = Header(default="")):
    key = os.getenv("RUNTIME_API_KEY")
    if not key or not hmac.compare_digest(x_service_key, key): raise HTTPException(401, "bad service key")
    http = get_gateway_http()
    def call(name, args):
        try: r = http.post(f"/internal/v1/tools/{name}", json=args, headers={"Authorization": "Bearer " + req.token})
        except httpx.HTTPError as e: return False, type(e).__name__
        return (True, r.json()["result"]) if r.status_code == 200 else (False, f"{r.status_code} {r.text[:100]}")
    try: return investigate(req.case, call)
    finally: http.close()
