import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { apiBlob, apiJson, casePath } from "../lib/api";
import { canApprove, canProcess, getUser } from "../lib/config";
import { POLL_MS } from "../lib/constants";
import {
  buildPipeline,
  mapFields,
  permissionsFor,
  pipelineProgress,
  reviewReasons,
} from "../lib/pipeline";
import ProcessTheater from "../components/ProcessTheater";
import DecisionModal from "../components/DecisionModal";
import InvoicePdf from "../components/InvoicePdf";

export default function Review({ userId, showToast }) {
  const { caseId } = useParams();
  const navigate = useNavigate();
  const user = getUser(userId);
  const [row, setRow] = useState(null);
  const [fields, setFields] = useState([]);
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfError, setPdfError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [modal, setModal] = useState(null);
  const pdfUrlRef = useRef("");

  const load = useCallback(async () => {
    if (!caseId) return;
    try {
      const data = await apiJson("GET", casePath(caseId));
      setRow(data);
      setFields(mapFields(data));
      setError("");
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [caseId]);

  useEffect(() => {
    let alive = true;

    async function boot() {
      const data = await load();
      if (!alive || !data) return;

      try {
        const blob = await apiBlob(`${casePath(caseId)}/document`);
        if (!alive) return;
        const bytes = await blob.arrayBuffer();
        if (!alive) return;
        const pdfBlob = new Blob([bytes], { type: "application/pdf" });
        if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
        const url = URL.createObjectURL(pdfBlob);
        pdfUrlRef.current = url;
        setPdfUrl(url);
        setPdfError("");
      } catch (err) {
        if (!alive) return;
        setPdfUrl("");
        setPdfError(err?.message || "Document unavailable");
      }
    }

    boot();

    return () => {
      alive = false;
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = "";
      }
    };
  }, [caseId, load]);

  useEffect(() => {
    if (!row) return undefined;
    const perms = permissionsFor(row, canProcess(user), canApprove(user));
    if (!perms.isProcessing) return undefined;
    const timer = setTimeout(() => {
      load();
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [row, user, load]);

  const steps = useMemo(() => (row ? buildPipeline(row) : []), [row]);
  const progress = pipelineProgress(steps);
  const perms = row ? permissionsFor(row, canProcess(user), canApprove(user)) : {};
  const reasons = row ? reviewReasons(row) : [];
  const title = row?.invoice_number || row?.file_name || "Invoice";
  const supplier = row?.supplier_name || "Supplier pending";

  async function saveFields() {
    const changes = {};
    fields.forEach((f) => {
      const value = String(f.value || "").trim();
      if (value !== f.original) changes[f.key] = value;
    });
    if (!Object.keys(changes).length) {
      showToast?.("No changes to save");
      return;
    }
    setModal({
      kind: "fields",
      title: "Save corrections",
      label: "What did you correct and why?",
      placeholder: "e.g. Total checked against the PDF",
      submitText: "Save",
      minLength: 0,
      payload: changes,
    });
  }

  function openDecide(action) {
    if (action === "approve") {
      setModal({
        kind: action,
        title: "Approve invoice",
        label: "Comment (optional)",
        placeholder: "Add a note for the audit trail",
        submitText: "Approve",
        minLength: 0,
      });
    } else if (action === "return") {
      setModal({
        kind: action,
        title: "Send back",
        label: "What should be fixed?",
        placeholder: "Reason for sending this back",
        submitText: "Send back",
        minLength: 3,
      });
    } else {
      setModal({
        kind: action,
        title: "Reject invoice",
        label: "Why is this rejected?",
        placeholder: "Reason for this decision",
        submitText: "Reject",
        minLength: 3,
      });
    }
  }

  async function onModalSubmit(text) {
    const current = modal;
    setModal(null);
    setBusy(true);
    try {
      if (current.kind === "fields") {
        await apiJson("PATCH", `${casePath(caseId)}/fields`, {
          fields: current.payload,
          comment: text,
        });
        showToast?.("Corrections saved");
      } else {
        await apiJson("POST", `${casePath(caseId)}/${current.kind}`, { comment: text });
        const labels = { approve: "Approved", return: "Sent back", reject: "Rejected" };
        showToast?.(labels[current.kind] || "Done");
      }
      await load();
      if (current.kind === "approve" || current.kind === "reject") {
        navigate("/");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!row && !error) {
    return (
      <div className="page-enter">
        <div className="empty-note empty-note--rich">
          <strong>Opening invoice</strong>
          <span>Pulling the document and extracted fields…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="page-enter review-page">
      <header className="review-top">
        <div className="review-top__lead">
          <Link to="/" className="btn btn-ghost btn-compact">
            ← Desk
          </Link>
          <div className="review-top__title">
            <p className="section-label">Review</p>
            <h1>{title}</h1>
            <p className="muted">{supplier}</p>
          </div>
        </div>
        <span className={`pill pill-${perms.isProcessing ? "working" : "review"}`}>
          {perms.isProcessing ? progress.nowText : "Ready for you"}
        </span>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      {perms.isProcessing ? (
        <motion.div
          className="review-processing-banner"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <ProcessTheater
            steps={steps}
            variant="compact"
            title="Still working"
            subtitle="Each step lights as ClearDesk finishes reading"
          />
        </motion.div>
      ) : null}

      <div className="review-grid">
        <section className="panel panel--document">
          <div className="panel-head">
            <div>
              <h2>Invoice</h2>
              <p className="muted panel-head__sub">{row?.file_name || "PDF document"}</p>
            </div>
            {pdfUrl ? (
              <a className="details-link" href={pdfUrl} target="_blank" rel="noreferrer">
                Open in tab
              </a>
            ) : null}
          </div>
          {pdfError && !pdfUrl ? (
            <div className="pdf-state">
              <p>Document unavailable</p>
              <span>{pdfError}</span>
            </div>
          ) : (
            <InvoicePdf blobUrl={pdfUrl} fileName={row?.file_name} />
          )}
        </section>

        <section className="panel panel--fields">
          <div className="panel-head">
            <div>
              <h2>Extracted fields</h2>
              <p className="muted panel-head__sub">Check against the PDF, then decide</p>
            </div>
          </div>

          {reasons.length > 0 && (
            <ul className="reasons">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}

          <div className="fields">
            {fields.map((field) => (
              <div
                key={field.key}
                className={`field${field.needsAttention ? " attention" : ""}`}
              >
                <label htmlFor={field.key}>
                  {field.label}
                  {field.needsAttention ? <em>Check</em> : null}
                </label>
                <input
                  id={field.key}
                  value={field.value}
                  disabled={!perms.canEdit}
                  onChange={(e) =>
                    setFields((prev) =>
                      prev.map((f) =>
                        f.key === field.key ? { ...f, value: e.target.value } : f,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>

          <div className="review-how">
            <button type="button" className="details-link" onClick={() => setShowHow((v) => !v)}>
              {showHow ? "Hide how we checked this" : "See how we checked this"}
            </button>
            {showHow ? (
              <div className="details">
                <ProcessTheater
                  steps={steps}
                  variant="compact"
                  title="Full process"
                  subtitle="How ClearDesk checked this invoice"
                />
                {row?.validation?.agent_trace?.length ? (
                  <ul>
                    {row.validation.agent_trace.map((t, i) => (
                      <li key={`${t.agent}-${i}`}>
                        {t.agent}: {t.status}
                        {t.summary ? ` — ${t.summary}` : ""}
                        {t.duration_ms != null ? ` (${t.duration_ms} ms)` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted" style={{ marginTop: "0.75rem", padding: "0 0.25rem" }}>
                    No advanced agent details on this case.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <div className="dock">
        <div className="dock-copy">
          {perms.canDecide ? (
            <>
              <strong>Your decision</strong>
              <span className="muted">Approve, send back, or reject — this becomes the audit trail.</span>
            </>
          ) : perms.canEdit ? (
            <>
              <strong>Processor</strong>
              <span className="muted">
                Correct fields, save, then switch role to <em>Approver</em> to decide.
              </span>
            </>
          ) : (
            <>
              <strong>View only</strong>
              <span className="muted">This role cannot edit or decide on this invoice.</span>
            </>
          )}
        </div>
        <div className="btn-row">
          {perms.canEdit && (
            <button type="button" className="btn btn-ghost" onClick={saveFields} disabled={busy}>
              Save corrections
            </button>
          )}
          {perms.canDecide && (
            <>
              <button
                type="button"
                className="btn btn-warn"
                onClick={() => openDecide("return")}
                disabled={busy}
              >
                Send back
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => openDecide("reject")}
                disabled={busy}
              >
                Reject
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => openDecide("approve")}
                disabled={busy}
              >
                Approve
              </button>
            </>
          )}
        </div>
      </div>

      {modal ? (
        <DecisionModal
          title={modal.title}
          label={modal.label}
          placeholder={modal.placeholder}
          submitText={modal.submitText}
          minLength={modal.minLength}
          onCancel={() => setModal(null)}
          onSubmit={onModalSubmit}
        />
      ) : null}

      {busy ? (
        <div className="busy-overlay">
          <div className="spinner" />
        </div>
      ) : null}
    </div>
  );
}
