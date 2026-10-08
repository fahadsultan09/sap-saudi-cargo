"""ap-posting-command: the only code that writes to SAP. Checks approval, package hash and idempotency key."""
import hashlib, json, sqlite3
from .core import get, Refused
from .db import emit
def post(c, cid):
    cs = get(c, cid)
    if cs["status"] not in ("READY_TO_POST", "POSTED", "CLOSED"): raise Refused(409, "no approved package")
    if hashlib.sha256((cs["pkg"] + str(cid)).encode()).hexdigest() != cs["pkg_hash"]: raise Refused(409, "package changed after approval")
    key = f"post-{cid}-{cs['pkg_hash']}"
    old = c.execute("SELECT doc FROM post_command WHERE key=?", (key,)).fetchone()
    if old:
        with c: emit(c, cid, "SYSTEM_ACTION", "ap-posting-command", f"replay refused, doc {old['doc']} exists")
        raise Refused(409, f"already posted as {old['doc']}")
    pkg = json.loads(cs["pkg"])
    with c:  # key, SAP document and case state commit together or not at all
        n = c.execute("SELECT COUNT(*) n FROM sap_doc").fetchone()["n"]; doc = f"51000000{41 + n}"
        c.execute("INSERT INTO post_command VALUES(?,?)", (key, doc))
        c.execute("INSERT INTO sap_doc VALUES(?,?,?,?)", (doc, pkg["vendor"], pkg["inv_no"], pkg["amount"]))
        c.execute("UPDATE ap_case SET status='POSTED', doc=? WHERE id=?", (doc, cid))
        emit(c, cid, "SYSTEM_ACTION", "ap-posting-command", f"POSTING_EXECUTE ok, doc {doc}")
    return doc
def reconcile(c, cid):
    cs = get(c, cid)
    if cs["status"] != "POSTED": raise Refused(409, "nothing to reconcile")
    d = c.execute("SELECT * FROM sap_doc WHERE doc=?", (cs["doc"],)).fetchone()
    ok = d and d["amount"] == json.loads(cs["pkg"])["amount"]
    with c:
        emit(c, cid, "EXTERNAL_OBSERVATION", "ap-worker-sap", "read-back " + ("matches package" if ok else "MISMATCH"))
        c.execute("UPDATE ap_case SET status=? WHERE id=?", ("CLOSED" if ok else "MISMATCH", cid))
