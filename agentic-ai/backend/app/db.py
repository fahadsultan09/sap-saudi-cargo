"""Persistence. SQLite stands in for SAP HANA Cloud. Swap this module for hdbcli and keep the SQL."""
import os, sqlite3, hashlib, json
SCHEMA = """
CREATE TABLE IF NOT EXISTS ap_case(id INTEGER PRIMARY KEY AUTOINCREMENT, vendor TEXT, inv_no TEXT, net TEXT, vat TEXT, po TEXT,
  status TEXT, judgement TEXT, confirmed_by TEXT, approved_by TEXT, pkg TEXT, pkg_hash TEXT, doc TEXT);
CREATE TABLE IF NOT EXISTS rule_result(case_id INTEGER, rule TEXT, result TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS work_event(seq INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, kind TEXT, actor TEXT, text TEXT, prev TEXT, hash TEXT);
CREATE TABLE IF NOT EXISTS sap_doc(doc TEXT PRIMARY KEY, vendor TEXT, inv_no TEXT, amount TEXT);
CREATE TABLE IF NOT EXISTS document(case_id INTEGER, filename TEXT, sha256 TEXT, mime TEXT, data BLOB);
CREATE TABLE IF NOT EXISTS extraction(case_id INTEGER, field TEXT, value TEXT, confidence REAL);
CREATE TABLE IF NOT EXISTS tool_call(jti TEXT, case_id INTEGER, name TEXT, args TEXT, result TEXT);
CREATE TABLE IF NOT EXISTS post_command(key TEXT PRIMARY KEY, doc TEXT);
"""
def connect():
    c = sqlite3.connect(os.getenv("AP_DB", "ap.db"), check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c
def init():
    c = connect(); c.executescript(SCHEMA)
    if not c.execute("SELECT 1 FROM sap_doc").fetchone():
        c.execute("INSERT INTO sap_doc VALUES('5100000041','V100','INV-5520','4600.00')")
    c.commit(); c.close()
def emit(c, case_id, kind, actor, text):
    """Event journal with hash chain. Always called inside the caller's transaction."""
    r = c.execute("SELECT hash FROM work_event ORDER BY seq DESC LIMIT 1").fetchone()
    prev = r["hash"] if r else "0" * 64
    h = hashlib.sha256((prev + kind + text).encode()).hexdigest()
    c.execute("INSERT INTO work_event(case_id,kind,actor,text,prev,hash) VALUES(?,?,?,?,?,?)", (case_id, kind, actor, text, prev, h))
