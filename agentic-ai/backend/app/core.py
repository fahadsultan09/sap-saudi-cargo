"""AP Core: owns case state. Every transition is one transaction that also writes the journal event."""
import json, hashlib
from . import sap, rules, agents, document, agent_runner
from .db import emit
import time

class Refused(Exception):
    def __init__(s, code, msg):
        s.code, s.msg = code, msg


def get(c, cid):
    r = c.execute("SELECT * FROM ap_case WHERE id=?", (cid,)).fetchone()
    if not r:
        raise Refused(404, "case not found")
    return r


def create(c, d, actor):
    with c:
        cur = c.execute(
            "INSERT INTO ap_case(vendor,inv_no,net,vat,po,status) VALUES(?,?,?,?,?, 'RECEIVED')",
            (d["vendor"], d["inv_no"], d["net"], d["vat"], d["po"]),
        )
        emit(c, cur.lastrowid, "FACT", actor, f"invoice {d['inv_no']} received")
    return cur.lastrowid


def ingest(c, data, filename, actor):
    mime = document.sniff(data)
    if not mime:
        raise Refused(415, "unsupported or unsafe file type")
    sha = hashlib.sha256(data).hexdigest()
    with c:
        cid = c.execute("INSERT INTO ap_case(status) VALUES('RECEIVED')").lastrowid
        c.execute(
            "INSERT INTO document VALUES(?,?,?,?,?)", (cid, filename, sha, mime, data)
        )
        emit(c, cid, "FACT", actor, f"file {filename} received")
        emit(
            c,
            cid,
            "SYSTEM_ACTION",
            "ap-worker-intake",
            f"original stored, sha256 {sha[:16]}, type check passed",
        )
    return cid


COLS = ("vendor", "inv_no", "net", "vat", "po")


def extract(c, cid):
    cs = get(c, cid)

    d = c.execute(
        "SELECT * FROM document WHERE case_id=?",
        (cid,)
    ).fetchone()

    if not d:
        raise Refused(409, "no document on this case")

    if cs["status"] != "RECEIVED":
        raise Refused(409, "already extracted")

    try:
        raw = document.get_extractor().extract(
            d["data"],
            d["filename"],
            d["mime"]
        )

        # print("RAW RESULT =", raw)
        # print("RAW TYPE =", type(raw))

        if raw is None:
            raise Exception(
                "Document AI returned None. Check SAP response logs."
            )

    except Exception as e:
        print("DOC AI ERROR =", repr(e))
        raise

    if raw is None:
        raise Exception("Document AI returned None")

    # print("RAW RESULT =", raw)
    # print("RAW TYPE =", type(raw))

    f = {k: dict(v) for k, v in raw.items()}

    if "vendor_name" in f:

        vendor_name = f["vendor_name"]["value"]

        f.pop("vendor_name")

        f["vendor"] = {
            "value": vendor_name,
            "confidence": raw["vendor_name"]["confidence"],
        }

    for k in ("net", "vat"):
        if k in f:
            f[k]["value"] = document.money(f[k]["value"])

    low = [
        k
        for k in COLS
        if (
            k not in f
            or not f[k]["value"]
            or f[k]["confidence"] < document.MIN_CONF
        )
    ]
    with c:
        for k in COLS:
            if k in f:
                c.execute(
                    "INSERT INTO extraction VALUES(?,?,?,?)",
                    (cid, k, f[k]["value"], f[k]["confidence"]),
                )
        sets = {k: f[k]["value"] for k in COLS if k in f and f[k]["value"]}
        if sets:
            c.execute(
                "UPDATE ap_case SET "
                + ",".join(f"{k}=?" for k in sets)
                + " WHERE id=?",
                (*sets.values(), cid),
            )
        emit(
            c,
            cid,
            "EXTERNAL_OBSERVATION",
            "ap-worker-document",
            "Document AI fields: "
            + ", ".join(f"{k}={f[k]['confidence']:.2f}" for k in COLS if k in f),
        )
        c.execute(
            "UPDATE ap_case SET status=? WHERE id=?",
            ("NEEDS_REVIEW" if low else "EXTRACTED", cid),
        )
        if low:
            emit(
                c,
                cid,
                "SYSTEM_ACTION",
                "ap-core",
                "low confidence or missing: " + ", ".join(low),
            )

def review(c, cid, user, fix):
    cs = get(c, cid)
    if cs["status"] != "NEEDS_REVIEW":
        raise Refused(409, "not awaiting review")
    fix = {k: v for k, v in fix.items() if k in COLS and v}
    merged = {k: fix.get(k) or cs[k] for k in COLS}
    if not all(merged.values()):
        raise Refused(
            422,
            "all five fields are required: "
            + ", ".join(k for k in COLS if not merged[k]),
        )
    with c:
        c.execute(
            "UPDATE ap_case SET "
            + ",".join(f"{k}=?" for k in COLS)
            + ", status='EXTRACTED' WHERE id=?",
            (*merged.values(), cid),
        )
        emit(
            c,
            cid,
            "HUMAN_DECISION",
            user,
            "reviewed extraction, corrected: " + (", ".join(fix) or "nothing"),
        )


def decide(c, cid, actor):
    inv = dict(get(c, cid))
    if inv["status"] == "NEEDS_REVIEW":
        raise Refused(409, "extraction needs human review first")
    if (
        inv["status"] == "RECEIVED"
        and c.execute("SELECT 1 FROM document WHERE case_id=?", (cid,)).fetchone()
    ):
        raise Refused(409, "run extraction first")
    if inv["status"] not in ("RECEIVED", "EXTRACTED"):
        raise Refused(409, "already decided")
    po, v = sap.read_po(inv["po"]), sap.read_vendor(inv["vendor"])
    posted = [dict(r) for r in c.execute("SELECT * FROM sap_doc")]
    R = rules.run(inv, po, v, posted)
    j, tr = agent_runner.advise(c, inv, po, R, case_id=cid)
    status = "WAITING_EXTERNAL" if j["act"] == "HOLD" else "AWAITING_CONFIRM"
    with c:
        emit(
            c,
            cid,
            "EXTERNAL_OBSERVATION",
            "ap-worker-sap",
            "read PO, GR, vendor (read only)",
        )
        for n, res, det in R:
            c.execute("INSERT INTO rule_result VALUES(?,?,?,?)", (cid, n, res, det))
            emit(c, cid, "RULE_RESULT", "ap-core", f"{n}={res}")
        for line in tr:
            emit(c, cid, "MODEL_JUDGEMENT", "agent", line)
        emit(
            c,
            cid,
            "MODEL_JUDGEMENT",
            "agent" if j["source"] == "agent" else "ap-core",
            f"[{j['source']}] recommends {j['act']} (advice only)",
        )
        c.execute(
            "UPDATE ap_case SET status=?, judgement=? WHERE id=?",
            (status, json.dumps(j), cid),
        )


def confirm(c, cid, user):
    cs = get(c, cid)
    if cs["status"] != "AWAITING_CONFIRM":
        raise Refused(409, "not awaiting confirmation")
    j = json.loads(cs["judgement"])
    with c:
        emit(c, cid, "HUMAN_DECISION", user, f"confirmed {j['act']}")
        if j["act"] == "REJECT":
            c.execute(
                "UPDATE ap_case SET status='REJECTED', confirmed_by=? WHERE id=?",
                (user, cid),
            )
            return
        pkg = json.dumps(
            {
                "act": "POST",
                "amount": j["amount"],
                "vendor": cs["vendor"],
                "inv_no": cs["inv_no"],
                "po": cs["po"],
            },
            sort_keys=True,
        )
        c.execute(
            "UPDATE ap_case SET status='AWAITING_APPROVAL', confirmed_by=?, pkg=? WHERE id=?",
            (user, pkg, cid),
        )


def approve(c, cid, user):
    cs = get(c, cid)
    if cs["status"] != "AWAITING_APPROVAL":
        raise Refused(409, "not awaiting approval")
    if user == cs["confirmed_by"]:
        raise Refused(403, "segregation of duties: preparer cannot approve")
    h = hashlib.sha256((cs["pkg"] + str(cid)).encode()).hexdigest()
    with c:
        emit(c, cid, "HUMAN_DECISION", user, f"approved frozen package {h[:12]}")
        c.execute(
            "UPDATE ap_case SET status='READY_TO_POST', approved_by=?, pkg_hash=? WHERE id=?",
            (user, h, cid),
        )
