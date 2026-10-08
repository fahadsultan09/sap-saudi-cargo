import { useEffect, useState } from "react";
type Rule = { rule: string; result: string; detail: string };
type Judgement = { act: string; amount: string; text: string; conf: number; source: string; evidence: string[]; trace: string[] };
type Case = { id: number; inv_no: string | null; vendor: string | null; status: string; confirmed_by?: string; approved_by?: string; doc?: string; judgement?: Judgement; rules?: Rule[]; extraction?: { field: string; value: string; confidence: number }[] };
type Ev = { seq: number; kind: string; actor: string; text: string; hash: string };
const USERS = { aisha: "processor", layla: "processor", omar: "approver" } as const;
type U = keyof typeof USERS;
export default function App() {
  const [user, setUser] = useState<U>("aisha"); const [cases, setCases] = useState<Case[]>([]); const [sel, setSel] = useState<Case | null>(null);
  const [events, setEvents] = useState<Ev[]>([]); const [err, setErr] = useState(""); const [tab, setTab] = useState<"case" | "audit">("case");
  const hd = { "X-User": user, "X-Role": USERS[user] };
  const call = async (path: string, method = "GET", body?: BodyInit, json = false) => {
    const r = await fetch(path, { method, headers: json ? { ...hd, "Content-Type": "application/json" } : hd, body });
    const j = await r.json(); if (!r.ok) { setErr(typeof j.detail === "string" ? j.detail : "request failed"); throw new Error(); } setErr(""); return j;
  };
  const load = async () => setCases(await call("/api/v1/cases"));
  const open = async (id: number) => { setSel(await call(`/api/v1/cases/${id}`)); setEvents(await call(`/api/v1/events?case_id=${id}`)); };
  const act = async (p: string) => { try { await call(p, "POST"); } catch { return; } await load(); if (sel) await open(sel.id); };
  useEffect(() => { load(); const es = new EventSource("/api/v1/stream"); es.onmessage = () => { load(); }; return () => es.close(); }, [user]);
  const upload = async (f: File) => { const fd = new FormData(); fd.append("file", f); try { const j = await call("/api/v1/cases/upload", "POST", fd); await load(); await open(j.id); } catch { /* shown */ } };
  const s = sel?.status; const me = USERS[user];
  const can = (role: string, status: string) => me === role && s === status;
  return (<div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
    <h1>AP Console</h1>
    <div className="card"><label>User <select value={user} onChange={e => setUser(e.target.value as U)}>{Object.entries(USERS).map(([u, r]) => <option key={u} value={u}>{u} ({r})</option>)}</select></label>{" "}
      <label>Upload invoice (PDF, PNG, JPEG) <input type="file" onChange={e => e.target.files?.[0] && upload(e.target.files[0])} /></label>
      {err && <p style={{ color: "#b3261e", margin: "8px 0 0" }}>{err}</p>}</div>
    <div className="grid"><div>{cases.map(c => <button key={c.id} className={"case" + (sel?.id === c.id ? " sel" : "")} onClick={() => open(c.id)}><b>{c.inv_no ?? "(extracting)"}</b><br /><span className={"tag " + c.status}>{c.status}</span></button>)}</div>
    <div>{!sel ? <div className="card">Upload an invoice to start.</div> : <>
      <div className="card"><h2>{sel.inv_no} <span className={"tag " + sel.status}>{sel.status}</span></h2>
        <button disabled={!(me === "processor" && s === "EXTRACTED")} onClick={() => act(`/api/v1/cases/${sel.id}/decide`)}>1. Run checks</button>
        <button disabled={!can("processor", "AWAITING_CONFIRM")} onClick={() => act(`/api/v1/cases/${sel.id}/confirm`)}>2. Confirm</button>
        <button disabled={!can("approver", "AWAITING_APPROVAL")} onClick={() => act(`/api/v1/cases/${sel.id}/approve`)}>3. Approve</button>
        <button disabled={!(me === "approver" && s === "READY_TO_POST")} onClick={() => act(`/internal/v1/dispatch/${sel.id}/post`)}>4. Post</button>
        <button className="alt" disabled={!(me === "approver" && ["READY_TO_POST", "POSTED", "CLOSED"].includes(s || ""))} onClick={() => act(`/internal/v1/dispatch/${sel.id}/post`)}>Post again (should refuse)</button>
        <button disabled={!(me === "approver" && s === "POSTED")} onClick={() => act(`/internal/v1/dispatch/${sel.id}/reconcile`)}>5. Reconcile</button>
        {sel.doc && <p>SAP document: <b>{sel.doc}</b></p>}
        <div style={{ marginTop: 8 }}><button className={tab === "case" ? "" : "alt"} onClick={() => setTab("case")}>Case</button><button className={tab === "audit" ? "" : "alt"} onClick={() => setTab("audit")}>Audit trail ({events.length})</button></div></div>
      {tab === "audit" ? <div className="card"><h2>Audit trail</h2>{events.map(e => <div key={e.seq} className={"ev " + e.kind}><small>#{e.seq} {e.kind} , {e.actor}</small>{e.text}<small>hash {e.hash.slice(0, 16)}</small></div>)}</div> : <>
        {sel.extraction?.length ? <div className="card"><h2>Document AI extraction</h2><table><tbody>{sel.extraction.map(x => <tr key={x.field}><td>{x.field}</td><td>{x.value}</td><td className={x.confidence < 0.8 ? "FAIL" : "PASS"}>{x.confidence}</td></tr>)}</tbody></table></div> : null}
        {sel.rules?.length ? <div className="card"><h2>Rules engine</h2><table><tbody>{sel.rules.map(r => <tr key={r.rule}><td>{r.rule}</td><td className={r.result}>{r.result}</td><td>{r.detail}</td></tr>)}</tbody></table></div> : null}
        {sel.judgement && <div className="card"><h2>Recommendation <span className="tag">{sel.judgement.source}</span> (advice only)</h2><div className="ai"><b>{sel.judgement.act}</b> {sel.judgement.amount !== "0" && sel.judgement.amount} , confidence {sel.judgement.conf}<br />{sel.judgement.text}
          {sel.judgement.evidence.length > 0 && <><br /><b>Evidence</b><ul>{sel.judgement.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></>}</div>
          {sel.judgement.trace.length > 0 && <details><summary>What the agent looked up</summary><ol>{sel.judgement.trace.map((t, i) => <li key={i} style={{ fontSize: 12 }}>{t}</li>)}</ol></details>}</div>}
      </>}</>}</div></div></div>);
}
