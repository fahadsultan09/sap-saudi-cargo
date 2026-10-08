import asyncio, json
from typing import Annotated
from fastapi import FastAPI, Depends, Header, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from . import db, core, posting
app = FastAPI(title="AP Core")
@app.on_event("startup")
def _s(): db.init()
class Invoice(BaseModel):
    vendor: str; inv_no: str; net: str = Field(pattern=r"^\d+(\.\d+)?$"); vat: str = Field(pattern=r"^\d+(\.\d+)?$"); po: str
class Review(BaseModel):
    vendor: str | None = None; inv_no: str | None = None; net: str | None = None; vat: str | None = None; po: str | None = None
class Principal(BaseModel): user: str; role: str
def principal(x_user: Annotated[str, Header()], x_role: Annotated[str, Header()]):
    # Dev stub. In BTP the AppRouter forwards a JWT; validate it with the XSUAA key and read role collections from its scopes.
    return Principal(user=x_user, role=x_role)
def need(p, role):
    if p.role != role: raise HTTPException(403, f"requires role {role}")
def run(fn, *a):
    c = db.connect()
    try: return fn(c, *a)
    except core.Refused as e: raise HTTPException(e.code, e.msg)
    finally: c.close()
def view(c, cid):
    r = dict(core.get(c, cid)); r["rules"] = [dict(x) for x in c.execute("SELECT rule,result,detail FROM rule_result WHERE case_id=?", (cid,))]
    r["extraction"] = [dict(x) for x in c.execute("SELECT field,value,confidence FROM extraction WHERE case_id=?", (cid,))]
    r["judgement"] = json.loads(r["judgement"]) if r["judgement"] else None; return r
@app.post("/api/v1/cases", status_code=201)
def create(inv: Invoice, p: Principal = Depends(principal)):
    need(p, "processor"); return run(lambda c: {"id": core.create(c, inv.model_dump(), p.user)})
@app.post("/api/v1/cases/upload", status_code=201)
async def upload(file: UploadFile, p: Principal = Depends(principal)):
    need(p, "processor"); data = await file.read()
    cid = run(core.ingest, data, file.filename or "invoice", p.user); run(core.extract, cid); return run(lambda c: view(c, cid))
@app.post("/api/v1/cases/{cid}/review")
def review(cid: int, fix: Review, p: Principal = Depends(principal)):
    need(p, "processor"); run(core.review, cid, p.user, fix.model_dump()); return run(lambda c: view(c, cid))
@app.get("/api/v1/cases")
def cases(p: Principal = Depends(principal)): return run(lambda c: [dict(r) for r in c.execute("SELECT id,vendor,inv_no,status FROM ap_case")])
@app.get("/api/v1/cases/{cid}")
def one(cid: int, p: Principal = Depends(principal)): return run(lambda c: view(c, cid))
@app.post("/api/v1/cases/{cid}/decide")
def decide(cid: int, p: Principal = Depends(principal)): need(p, "processor"); run(core.decide, cid, p.user); return run(lambda c: view(c, cid))
@app.post("/api/v1/cases/{cid}/confirm")
def confirm(cid: int, p: Principal = Depends(principal)): need(p, "processor"); run(core.confirm, cid, p.user); return run(lambda c: view(c, cid))
@app.post("/api/v1/cases/{cid}/approve")
def approve(cid: int, p: Principal = Depends(principal)): need(p, "approver"); run(core.approve, cid, p.user); return run(lambda c: view(c, cid))
@app.post("/internal/v1/dispatch/{cid}/post")
def post(cid: int, p: Principal = Depends(principal)): need(p, "approver"); return {"doc": run(posting.post, cid)}
@app.post("/internal/v1/dispatch/{cid}/reconcile")
def rec(cid: int, p: Principal = Depends(principal)): need(p, "approver"); run(posting.reconcile, cid); return run(lambda c: view(c, cid))
@app.get("/api/v1/events")
def events(case_id: int | None = None, p: Principal = Depends(principal)):
    return run(lambda c: [dict(r) for r in c.execute("SELECT * FROM work_event WHERE (? IS NULL OR case_id=?) ORDER BY seq", (case_id, case_id))])
@app.get("/api/v1/stream")
async def stream(p: Principal = Depends(principal)):
    async def gen():
        last = 0
        while True:
            c = db.connect(); rows = c.execute("SELECT seq,case_id,kind,text FROM work_event WHERE seq>? ORDER BY seq", (last,)).fetchall(); c.close()
            for r in rows: last = r["seq"]; yield f"data: {json.dumps(dict(r))}\n\n"
            await asyncio.sleep(2)
    return StreamingResponse(gen(), media_type="text/event-stream")
