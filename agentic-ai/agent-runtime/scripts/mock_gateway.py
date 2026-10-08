"""Stage 1 only: a fake tool gateway so you can test the agent runtime and your model WITHOUT the backend.
Run:  uvicorn scripts.mock_gateway:app --port 8001      then start the runtime with AP_CORE_URL=http://localhost:8001
It accepts any token and returns canned data for the sample cases. It prints every call the agent makes, so you can watch its behaviour."""
from fastapi import FastAPI, Header
app = FastAPI(title="Mock tool gateway (testing only)")
PO = {"4500012345": {"po": "4500012345", "vendor": "V100", "amount": "11500", "gr_total": "11500", "change_log": [{"date": "2026-09-30", "note": "Fuel surcharge of 900.00 SAR approved by procurement, PO amendment still pending"}]},
      "4500012346": {"po": "4500012346", "vendor": "V200", "amount": "8000", "gr_total": None, "change_log": []},
      "4500012347": {"po": "4500012347", "vendor": "V100", "amount": "4600", "gr_total": "4600", "change_log": []}}
GR = {"4500012345": {"posted": [{"date": "2026-10-02", "amount": "11500.00"}], "delivery_notes": []}, "4500012347": {"posted": [{"date": "2026-10-01", "amount": "4600.00"}], "delivery_notes": []},
      "4500012346": {"posted": [], "delivery_notes": [{"date": "2026-10-06", "note": "Delivered and signed at Dammam warehouse, GR not posted in S/4"}]}}
HIST = {"V100": [{"inv_no": "INV-6100", "variance": "+0.0%", "reason": "none"}, {"inv_no": "INV-6422", "variance": "+4.1%", "reason": "fuel surcharge later covered by PO amendment"}], "V200": [{"inv_no": "INV-8120", "variance": "+0.0%", "reason": "none"}]}
@app.post("/internal/v1/tools/{name}")
def tool(name: str, args: dict, authorization: str = Header(default="")):
    print(f"[mock gateway] agent called {name}({args})", flush=True)
    r = {"get_po": lambda: PO.get(args.get("po")), "get_goods_receipts": lambda: GR.get(args.get("po"), {"posted": [], "delivery_notes": []}),
         "vendor_history": lambda: HIST.get(args.get("vendor"), []), "find_similar_cases": lambda: []}.get(name)
    if not r: return {"result": {"error": "unknown tool"}}
    return {"result": r()}
