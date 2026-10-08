"""Bounded investigation loop. Advice only: output is validated, guarded against the rules data, and always goes to a human."""
import os, json, time
from decimal import Decimal as D
from typing import Literal
from pydantic import BaseModel, Field, ValidationError
from . import agents
from .tools import TOOLS
from .llm import get_llm
class Finding(BaseModel):
    action: Literal["POST", "HOLD", "REJECT"]; amount: str; summary: str; evidence: list[str] = Field(min_length=1); confidence: float = Field(ge=0, le=1)
SYSTEM = ("You investigate one invoice case for accounts payable. You may only advise. Reply with JSON only, one object per turn. "
          'To look something up: {"tool": "<name>", "args": {...}}. Tools: get_po(po), get_goods_receipts(po), vendor_history(vendor), find_similar_cases(vendor). '
          'When done: {"final": {"action": "POST|HOLD|REJECT", "amount": "<number>", "summary": "...", "evidence": ["..."], "confidence": 0.0-1.0}}. '
          "Cite only facts returned by tools. If evidence is missing, choose HOLD.")
def _json(t):
    try: return json.loads(t[t.index("{"): t.rindex("}") + 1])
    except ValueError: return None
def _guard(f, inv, po):
    gross = D(inv["net"]) + D(inv["vat"])
    if f.action == "POST":
        a = D(f.amount)
        if not (po and po["amount"] <= a <= gross): return "POST amount outside PO value and invoice total"
    return None
def advise(c, inv, po, rules, llm=None):
    """Returns (judgement dict, list of trace lines). Plain rules handle clean and duplicate cases without any model call."""
    res = {r[0]: r[1] for r in rules}
    if os.getenv("AGENT_MODE", "stub") == "off" or res["DUPLICATE"] == "FAIL" or all(v == "PASS" for v in res.values()):
        j = agents.recommend(inv, po, rules); j.update(source="rules", evidence=[], trace=[]); return j, []
    llm = llm or get_llm(); case = {k: inv[k] for k in ("vendor", "inv_no", "net", "vat", "po")}; case["gross"] = str(D(inv["net"]) + D(inv["vat"]))
    case["rules"] = {r[0]: f"{r[1]} ({r[2]})" for r in rules}
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": json.dumps(case)}]; trace = []; end = time.monotonic() + float(os.getenv("AGENT_TIMEOUT", "60"))
    why = "step limit reached"
    for _ in range(int(os.getenv("AGENT_MAX_STEPS", "6"))):
        if time.monotonic() > end: why = "timeout"; break
        try: out = llm.chat(msgs)
        except Exception as e: why = f"model error: {type(e).__name__}"; break
        obj = _json(out)
        if not obj: trace.append("invalid reply, asked again"); msgs += [{"role": "assistant", "content": out}, {"role": "user", "content": "Reply with one JSON object only."}]; continue
        if "final" in obj:
            try: f = Finding(**obj["final"])
            except (ValidationError, TypeError) as e: why = "final answer failed schema check"; break
            bad = _guard(f, inv, po)
            if bad: why = "guard: " + bad; break
            trace.append(f"final: {f.action} {f.amount}")
            return {"act": f.action, "amount": f.amount, "text": f.summary, "conf": f.confidence, "source": "agent", "evidence": f.evidence, "trace": trace}, trace
        name, args = obj.get("tool"), obj.get("args") or {}
        if name not in TOOLS: trace.append(f"REFUSED tool '{name}' (not in allow-list)"); msgs += [{"role": "assistant", "content": out}, {"role": "user", "content": "Tool not allowed. Use only the listed tools."}]; continue
        try: r = TOOLS[name](c, **args)
        except TypeError: r = {"error": "bad arguments"}
        trace.append(f"{name}({', '.join(f'{k}={v}' for k, v in args.items())}) -> {json.dumps(r)[:140]}")
        msgs += [{"role": "assistant", "content": out}, {"role": "user", "content": "TOOL_RESULT: " + json.dumps({"tool": name, "result": r})}]
    j = agents.recommend(inv, po, rules); j.update(source="rules (agent fallback)", evidence=[], trace=trace + [f"agent discarded: {why}"]); return j, trace + [f"agent discarded: {why}"]
