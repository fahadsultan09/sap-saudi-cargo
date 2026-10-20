import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
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
import { loadUploadSession } from "../lib/uploadSession";
import ProcessTheater from "../components/ProcessTheater";
import DecisionModal from "../components/DecisionModal";
import InvoicePdf from "../components/InvoicePdf";

function Disclosure({ id, label, open, onToggle, children }) {
  return (
    <div className="disclosure">
      <button
        type="button"
        className="disclosure__trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <span>{open ? "Hide" : "Show"} {label}</span>
        <span className="disclosure__chevron" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={id}
            className="disclosure__panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28 }}
          >
            <div className="disclosure__inner">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function Review({ userId, showToast }) {
  const { caseId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const user = getUser(userId);
  const [row, setRow] = useState(null);
  const [fields, setFields] = useState([]);
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfError, setPdfError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(null);
  const [modal, setModal] = useState(null);
  const pdfUrlRef = useRef("");

  const fromUpload = useMemo(() => {
    if (location.state?.fromUpload) return true;
    const session = loadUploadSession();
    return session?.phase === "complete" && session?.caseId === caseId;
  }, [location.state, caseId]);

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
  const hasTrace = Boolean(row?.validation?.agent_trace?.length);

  const purpose = useMemo(() => {
    if (perms.isProcessing) {
      return {
        eyebrow: "In progress",
        title: "Agents are still reading this invoice",
        next: "Fields unlock when the runway finishes — stay on this screen or come back from Home.",
      };
    }
    if (perms.canDecide) {
      return {
        eyebrow: "Approver",
        title: "Decide: approve, send back, or reject",
        next: "Compare the PDF with the fields, then record your decision in the bar below.",
      };
    }
    if (perms.canEdit) {
      return {
        eyebrow: "Processor",
        title: "You’re here to check extracted fields before approval",
        next: "Correct anything that doesn’t match the PDF, save, then switch role to Approver.",
      };
    }
    return {
      eyebrow: "View only",
      title: "Invoice detail",
      next: "This role can view the document and fields but cannot edit or decide.",
    };
  }, [perms.isProcessing, perms.canDecide, perms.canEdit]);

  function togglePanel(name) {
    setPanel((current) => (current === name ? null : name));
  }

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
          {fromUpload ? (
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={() => navigate("/upload", { state: { restoreCaseId: caseId } })}
            >
              ← Back
            </button>
          ) : (
            <Link to="/" className="btn btn-ghost btn-compact">
              ← Desk
            </Link>
          )}
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

      <aside className="purpose-strip" aria-label="Why you are here">
        <div className="purpose-strip__copy">
          <p className="purpose-strip__eyebrow">{purpose.eyebrow}</p>
          <p className="purpose-strip__title">{purpose.title}</p>
          <p className="purpose-strip__next">{purpose.next}</p>
        </div>
      </aside>

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
            title="Agents at work"
            subtitle="Live actions below — each step shows what it’s doing right now"
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
              <p className="muted panel-head__sub">Match these to the PDF</p>
            </div>
            {reasons.length > 0 ? (
              <span className="pill pill-review">{reasons.length} to check</span>
            ) : null}
          </div>

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

          <div className="review-secondary">
            {reasons.length > 0 ? (
              <Disclosure
                id="review-flags"
                label="why this needs attention"
                open={panel === "flags"}
                onToggle={() => togglePanel("flags")}
              >
                <ul className="reasons reasons--nested">
                  {reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </Disclosure>
            ) : null}

            <Disclosure
              id="review-agents"
              label="agent activity"
              open={panel === "agents"}
              onToggle={() => togglePanel("agents")}
            >
              <ProcessTheater
                steps={steps}
                variant="compact"
                title="How we checked this"
                subtitle="Plain-language outcomes for each step"
              />
            </Disclosure>

            <Disclosure
              id="review-tech"
              label="technical details"
              open={panel === "tech"}
              onToggle={() => togglePanel("tech")}
            >
              {hasTrace ? (
                <ul className="tech-trace">
                  {row.validation.agent_trace.map((t, i) => (
                    <li key={`${t.agent}-${i}`}>
                      <code>{t.agent}</code>
                      <span>{t.status}</span>
                      {t.summary ? <em>{t.summary}</em> : null}
                      {t.duration_ms != null ? (
                        <span className="tech-trace__ms">{t.duration_ms} ms</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted disclosure__empty">
                  No internal agent ids on this case. Outcomes are shown under Agent activity.
                </p>
              )}
            </Disclosure>
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
              <strong>Save corrections</strong>
              <span className="muted">
                Fix mismatches, save, then switch role to <em>Approver</em> to decide.
              </span>
            </>
          ) : perms.isProcessing ? (
            <>
              <strong>Waiting on agents</strong>
              <span className="muted">Actions unlock when reading finishes.</span>
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
