"""Run the investigating agent on two sample cases with whatever AGENT_MODE is set. Use it to test your real AI Core deployment.
  AGENT_MODE=aicore AICORE_SERVICE_KEY='{...}' AICORE_DEPLOYMENT_URL='...' python scripts/agent_smoke.py
Exit code 1 if the agent was discarded (the rule-based fallback was used), so you can see the model is not producing usable answers."""
import sys, os, tempfile, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("AP_DB", tempfile.mktemp(suffix=".db"))
from app import db, sap, rules, agent_runner
CASES = [("900 SAR over PO, expect POST 12400.00 citing the surcharge", {"vendor": "V100", "inv_no": "INV-7782", "net": "10782.61", "vat": "1617.39", "po": "4500012345"}, "POST"),
         ("goods receipt missing, expect HOLD citing the delivery note", {"vendor": "V200", "inv_no": "INV-9001", "net": "6956.52", "vat": "1043.48", "po": "4500012346"}, "HOLD")]
db.init(); c = db.connect(); bad = 0
print("AGENT_MODE =", os.getenv("AGENT_MODE", "stub"))
for label, inv, want in CASES:
    po = sap.read_po(inv["po"]); R = rules.run(inv, po, sap.read_vendor(inv["vendor"]), [dict(r) for r in c.execute("SELECT * FROM sap_doc")])
    j, tr = agent_runner.advise(c, inv, po, R)
    print(f"\n== {label}\nsource={j['source']} action={j['act']} amount={j['amount']} conf={j['conf']} steps={j.get('steps')} ({'as expected' if j['act'] == want else 'DIFFERENT from expected'})")
    print("summary:", j["text"]); [print("  evidence:", e) for e in j["evidence"]]; [print("  trace:", t) for t in tr]
    bad += j["source"] != "agent"
sys.exit(1 if bad else 0)
