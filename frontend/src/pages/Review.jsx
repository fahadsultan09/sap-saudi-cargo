import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { apiBlob, apiJson, casePath } from "../lib/api";
import { nextDecidable } from "../lib/caseBoard";
import { canApprove, canProcess, getUser } from "../lib/config";
import { confidenceLabel, extractionConfidence } from "../lib/confidence";
import { DECIDABLE, POLL_MS } from "../lib/constants";
import { mapAuditTrail } from "../lib/history";
import {
  buildPipeline,
  formatAmount,
  formatDateTime,
  mapFields,
  outcomeLabel,
  permissionsFor,
  pipelineProgress,
  reviewReasons,
} from "../lib/pipeline";
import { loadUploadSession } from "../lib/uploadSession";
import ProcessTheater from "../components/ProcessTheater";
import DecisionModal from "../components/DecisionModal";
import InvoicePdf from "../components/InvoicePdf";
import StageDetailSheet from "../components/StageDetailSheet";
import DetailSheet from "../components/DetailSheet";
import ComparisonPanel from "../components/ComparisonPanel";
import AuditTimeline from "../components/AuditTimeline";

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
  const [modal, setModal] = useState(null);
  const [selectedStep, setSelectedStep] = useState(null);
  const [sheet, setSheet] = useState(null); // purpose | status | case | flags | confidence | field | compare | audit
  const [fieldFocus, setFieldFocus] = useState(null);
  const [reviewTab, setReviewTab] = useState("fields"); // fields | compare | audit
  const [audit, setAudit] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [decisionDone, setDecisionDone] = useState(null);
  const [queue, setQueue] = useState([]);
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

  const loadAudit = useCallback(async () => {
    if (!caseId) return;
    setAuditLoading(true);
    setAuditError("");
    try {
      const data = await apiJson("GET", `${casePath(caseId)}/history`);
      setAudit(mapAuditTrail(data));
    } catch (err) {
      setAuditError(err.message);
      setAudit([]);
    } finally {
      setAuditLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    if (reviewTab === "audit" || sheet === "audit") {
      loadAudit();
    }
  }, [reviewTab, sheet, loadAudit]);

  useEffect(() => {
    let alive = true;
    apiJson("GET", "/api/v1/cases?limit=200")
      .then((data) => {
        if (alive) setQueue(data.items || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [caseId, decisionDone]);

  useEffect(() => {
    setDecisionDone(null);
    setReviewTab("fields");
  }, [caseId]);

  const steps = useMemo(() => (row ? buildPipeline(row) : []), [row]);
  const progress = pipelineProgress(steps);
  const perms = row ? permissionsFor(row, canProcess(user), canApprove(user)) : {};
  const reasons = row ? reviewReasons(row) : [];
  const confidence = useMemo(() => (row ? extractionConfidence(row) : null), [row]);
  const title = row?.invoice_number || row?.file_name || "Invoice";
  const supplier = row?.supplier_name || "Supplier pending";
  const hasTrace = Boolean(row?.validation?.agent_trace?.length);

  const purpose = useMemo(() => {
    if (perms.isProcessing) {
      return {
        eyebrow: "In progress",
        title: "Agents are still reading this invoice",
        next: "Fields unlock when the runway finishes — stay on this screen or come back from Home.",
        detail:
          "Classifier, document reader, and finance check run in sequence. When they finish, extracted fields appear here for you to confirm.",
      };
    }
    if (perms.canDecide) {
      return {
        eyebrow: "Approver",
        title: "Decide: approve, send back, or reject",
        next: "Compare the PDF with the fields, then record your decision in the bar below.",
        detail:
          "Your decision becomes the audit trail. Approve if fields match the PDF, send back if corrections are needed, or reject if the invoice shouldn’t proceed.",
      };
    }
    if (perms.canEdit) {
      return {
        eyebrow: "Processor",
        title: "You’re here to check extracted fields before approval",
        next: "Correct anything that doesn’t match the PDF, save, then switch role to Approver.",
        detail:
          "Edit mismatched fields, save with a short note, then ask an Approver to decide. Flagged fields are the ones most worth checking first.",
      };
    }
    return {
      eyebrow: "View only",
      title: "Invoice detail",
      next: "This role can view the document and fields but cannot edit or decide.",
      detail: "Switch to Processor or Approver if you need to correct fields or record a decision.",
    };
  }, [perms.isProcessing, perms.canDecide, perms.canEdit]);

  function openFieldSheet(field) {
    setFieldFocus(field);
    setSheet("field");
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
        await load();
        loadAudit();
      } else {
        await apiJson("POST", `${casePath(caseId)}/${current.kind}`, { comment: text });
        const labels = { approve: "Approved", return: "Sent back", reject: "Rejected" };
        const label = labels[current.kind] || "Done";
        showToast?.(label);
        await load();
        let items = queue;
        try {
          const list = await apiJson("GET", "/api/v1/cases?limit=200");
          items = list.items || [];
          setQueue(items);
        } catch {
          /* keep prior queue */
        }
        const next = nextDecidable(items, caseId, DECIDABLE);
        setDecisionDone({
          kind: current.kind,
          label,
          nextId: next?.id || null,
          nextTitle: next?.invoice_number || next?.file_name || null,
        });
      }
    } catch (err) {
      const message = err.message || "Something went wrong";
      setError(message);
      showToast?.(message);
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

  const liveField =
    fieldFocus && fields.find((f) => f.key === fieldFocus.key)
      ? fields.find((f) => f.key === fieldFocus.key)
      : fieldFocus;

  return (
    <div className="page-enter review-page">
      <header className="review-top">
        <div className="review-top__lead">
          {fromUpload ? (
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={() => navigate("/")}
            >
              ← Home
            </button>
          ) : (
            <Link to="/desk" className="btn btn-ghost btn-compact">
              ← Desk
            </Link>
          )}
          <div className="review-top__title">
            <p className="section-label">Review</p>
            <button
              type="button"
              className="review-title-btn"
              onClick={() => setSheet("case")}
              aria-label="Open case details"
            >
              <h1>{title}</h1>
            </button>
            <button
              type="button"
              className="meta-chip meta-chip--inline muted"
              onClick={() => setSheet("case")}
            >
              {supplier}
              {caseId ? ` · ${String(caseId).slice(0, 8)}…` : ""}
            </button>
          </div>
        </div>
        <div className="review-top__chips">
          {confidence?.hasAny ? (
            <button
              type="button"
              className="pill pill-clickable pill-working"
              onClick={() => setSheet("confidence")}
              aria-label="Open confidence details"
            >
              {confidence.overall != null ? `${confidence.overall}%` : "Confidence"}
            </button>
          ) : null}
          <button
            type="button"
            className={`pill pill-clickable pill-${perms.isProcessing ? "working" : "review"}`}
            onClick={() => setSheet("status")}
            aria-label="Open status details"
          >
            {perms.isProcessing ? progress.nowText : outcomeLabel(row?.status) || "Ready for you"}
          </button>
        </div>
      </header>

      <button
        type="button"
        className="purpose-strip purpose-strip--clickable"
        aria-label="Why you are here — more detail"
        onClick={() => setSheet("purpose")}
      >
        <div className="purpose-strip__copy">
          <p className="purpose-strip__eyebrow">{purpose.eyebrow}</p>
          <p className="purpose-strip__title">{purpose.title}</p>
          <p className="purpose-strip__next">{purpose.next}</p>
        </div>
        <span className="purpose-strip__hint" aria-hidden="true">
          ⓘ
        </span>
      </button>

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
            interactive
            onStepSelect={setSelectedStep}
            title="Agents at work"
            subtitle="Tap a stage for details — live actions below"
          />
        </motion.div>
      ) : null}

      <div className="review-tabs" role="tablist" aria-label="Review panels">
        {[
          { id: "fields", label: "Fields" },
          { id: "compare", label: "Summary & SAP" },
          { id: "audit", label: "Audit trail" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={reviewTab === tab.id}
            className={`review-tab${reviewTab === tab.id ? " review-tab--active" : ""}`}
            onClick={() => setReviewTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="review-grid">
        <section className="panel panel--document">
          <div className="panel-head">
            <button
              type="button"
              className="panel-head__btn"
              onClick={() => setSheet("case")}
            >
              <h2>Invoice</h2>
              <p className="muted panel-head__sub">{row?.file_name || "PDF document"}</p>
            </button>
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
          {reviewTab === "fields" ? (
            <>
              <div className="panel-head">
                <div>
                  <h2>Extracted fields</h2>
                  <p className="muted panel-head__sub">Match these to the PDF · tap a label for detail</p>
                </div>
                {reasons.length > 0 ? (
                  <button
                    type="button"
                    className="pill pill-clickable pill-review"
                    onClick={() => setSheet("flags")}
                    aria-label={`${reasons.length} flags — open explanations`}
                  >
                    {reasons.length} to check
                  </button>
                ) : null}
              </div>

              <div className="fields">
                {fields.map((field) => (
                  <div
                    key={field.key}
                    className={`field${field.needsAttention ? " attention" : ""}`}
                  >
                    <button
                      type="button"
                      className="field__label-btn"
                      onClick={() => openFieldSheet(field)}
                    >
                      <span>{field.label}</span>
                      <span className="field__label-meta">
                        {field.confidence != null ? `${field.confidence}%` : null}
                        {field.needsAttention ? <em>Check</em> : null}
                      </span>
                    </button>
                    <input
                      id={field.key}
                      value={field.value}
                      disabled={!perms.canEdit}
                      aria-label={field.label}
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
                  <button
                    type="button"
                    className="disclosure-link"
                    onClick={() => setSheet("flags")}
                  >
                    Why this needs attention
                  </button>
                ) : null}
                <button
                  type="button"
                  className="disclosure-link"
                  onClick={() => setSheet("agents")}
                >
                  Agent activity
                </button>
                <button
                  type="button"
                  className="disclosure-link"
                  onClick={() => setReviewTab("compare")}
                >
                  Summary &amp; SAP comparison
                </button>
                <button
                  type="button"
                  className="disclosure-link"
                  onClick={() => setReviewTab("audit")}
                >
                  Audit trail
                </button>
                {confidence?.hasAny ? (
                  <button
                    type="button"
                    className="disclosure-link"
                    onClick={() => setSheet("confidence")}
                  >
                    Confidence details
                  </button>
                ) : null}
                <button
                  type="button"
                  className="disclosure-link"
                  onClick={() => setSheet("tech")}
                >
                  Technical details
                </button>
              </div>
            </>
          ) : null}

          {reviewTab === "compare" ? (
            <>
              <div className="panel-head">
                <div>
                  <h2>Summary &amp; comparison</h2>
                  <p className="muted panel-head__sub">
                    Verdict first, then issues and checks
                  </p>
                </div>
              </div>
              <ComparisonPanel
                caseRow={row}
                onGoFields={() => setReviewTab("fields")}
                canDecide={Boolean(perms.canDecide)}
                canEdit={Boolean(perms.canEdit)}
              />
            </>
          ) : null}

          {reviewTab === "audit" ? (
            <>
              <div className="panel-head">
                <div>
                  <h2>Audit trail</h2>
                  <p className="muted panel-head__sub">Uploads, edits, and decisions on this case</p>
                </div>
                <button type="button" className="btn btn-ghost btn-compact" onClick={loadAudit}>
                  Refresh
                </button>
              </div>
              <AuditTimeline items={audit} loading={auditLoading} error={auditError} />
            </>
          ) : null}
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

      <StageDetailSheet step={selectedStep} onClose={() => setSelectedStep(null)} />

      <DetailSheet
        open={sheet === "purpose"}
        onClose={() => setSheet(null)}
        title={purpose.title}
        eyebrow={purpose.eyebrow}
        glyph="✦"
        labelledBy="purpose-sheet-title"
      >
        <section className="stage-sheet__block">
          <h3>What to do next</h3>
          <p>{purpose.next}</p>
        </section>
        <section className="stage-sheet__block">
          <h3>More context</h3>
          <p>{purpose.detail}</p>
        </section>
      </DetailSheet>

      <DetailSheet
        open={sheet === "status"}
        onClose={() => setSheet(null)}
        title={outcomeLabel(row?.status) || "Status"}
        eyebrow="Case status"
        glyph="●"
        labelledBy="status-sheet-title"
      >
        <div className="stage-sheet__status">
          <span
            className={`agent-status agent-status--${
              perms.isProcessing ? "running" : "done"
            }`}
          >
            {perms.isProcessing ? progress.nowText : outcomeLabel(row?.status)}
          </span>
          <p className="stage-sheet__now">
            {perms.isProcessing
              ? `${progress.doneCount} of ${progress.total} stages complete`
              : "Ready for human review or already decided"}
          </p>
        </div>
        <section className="stage-sheet__block">
          <h3>Raw status</h3>
          <p>
            <code className="detail-code">{row?.status || "—"}</code>
          </p>
        </section>
        <section className="stage-sheet__block">
          <h3>Timestamps</h3>
          <ul className="detail-kv">
            <li>
              <span>Created</span>
              <strong>{formatDateTime(row?.created_at)}</strong>
            </li>
            <li>
              <span>Updated</span>
              <strong>{formatDateTime(row?.updated_at)}</strong>
            </li>
          </ul>
        </section>
      </DetailSheet>

      <DetailSheet
        open={sheet === "case"}
        onClose={() => setSheet(null)}
        title={title}
        eyebrow="Case"
        glyph="#"
        labelledBy="case-sheet-title"
      >
        <section className="stage-sheet__block">
          <h3>Case id</h3>
          <p>
            <code className="detail-code">{caseId}</code>
          </p>
        </section>
        <ul className="detail-kv detail-kv--block">
          <li>
            <span>Status</span>
            <strong>{outcomeLabel(row?.status)}</strong>
          </li>
          <li>
            <span>Supplier</span>
            <strong>{supplier}</strong>
          </li>
          <li>
            <span>Amount</span>
            <strong>{formatAmount(row)}</strong>
          </li>
          <li>
            <span>File</span>
            <strong>{row?.file_name || "—"}</strong>
          </li>
          <li>
            <span>Created</span>
            <strong>{formatDateTime(row?.created_at)}</strong>
          </li>
          <li>
            <span>Updated</span>
            <strong>{formatDateTime(row?.updated_at)}</strong>
          </li>
        </ul>
      </DetailSheet>

      <DetailSheet
        open={sheet === "flags"}
        onClose={() => setSheet(null)}
        title="Why this needs attention"
        eyebrow="Flags"
        glyph="!"
        labelledBy="flags-sheet-title"
      >
        {reasons.length ? (
          <ul className="reasons">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          <section className="stage-sheet__block">
            <p>No open flags on this case.</p>
          </section>
        )}
      </DetailSheet>

      <DetailSheet
        open={sheet === "confidence"}
        onClose={() => setSheet(null)}
        title="Extraction confidence"
        eyebrow="How we scored this"
        glyph="%"
        labelledBy="review-confidence-title"
      >
        {confidence?.hasAny ? (
          <>
            <div className="stage-sheet__status">
              <span className="agent-status agent-status--done">
                {confidence.overall != null ? `${confidence.overall}%` : "—"}
              </span>
              <p className="stage-sheet__now">{confidenceLabel(confidence.source)}</p>
            </div>
            <section className="stage-sheet__block">
              <h3>How this score was derived</h3>
              <p>
                {confidence.source === "average"
                  ? "We averaged the confidence of each extracted field when an overall score wasn’t provided."
                  : confidence.source === "classification"
                    ? "This figure is how sure the classifier is that the file is an invoice."
                    : "This is the overall extraction confidence returned after reading the PDF."}
              </p>
            </section>
            {confidence.classification != null ? (
              <section className="stage-sheet__block">
                <h3>Document type</h3>
                <p>{confidence.classification}% sure this is an invoice (or credit note).</p>
              </section>
            ) : null}
            {confidence.fields?.length ? (
              <section className="stage-sheet__block">
                <h3>Per-field confidence</h3>
                <ul className="detail-kv">
                  {confidence.fields.map((f) => (
                    <li key={f.key}>
                      <span>{f.label}</span>
                      <strong>{f.percent}%</strong>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <section className="stage-sheet__block">
                <h3>Per-field scores</h3>
                <p>Field-level scores aren’t on this case — only the overall figure from reading.</p>
              </section>
            )}
          </>
        ) : (
          <section className="stage-sheet__block">
            <p>Confidence wasn’t returned for this case.</p>
          </section>
        )}
      </DetailSheet>

      <DetailSheet
        open={sheet === "field" && Boolean(liveField)}
        onClose={() => {
          setSheet(null);
          setFieldFocus(null);
        }}
        title={liveField?.label || "Field"}
        eyebrow="Field detail"
        glyph="◎"
        labelledBy="field-sheet-title"
      >
        {liveField ? (
          <>
            <section className="stage-sheet__block">
              <h3>Current value</h3>
              <p className="detail-value">{liveField.value || "—"}</p>
            </section>
            <ul className="detail-kv detail-kv--block">
              <li>
                <span>Confidence</span>
                <strong>
                  {liveField.confidence != null ? `${liveField.confidence}%` : "Not scored"}
                </strong>
              </li>
              <li>
                <span>Required</span>
                <strong>{liveField.required ? "Yes" : "No"}</strong>
              </li>
              <li>
                <span>Needs check</span>
                <strong>{liveField.needsAttention ? "Yes" : "No"}</strong>
              </li>
            </ul>
            <section className="stage-sheet__block">
              <h3>Source</h3>
              <p>{liveField.sourceHint}</p>
            </section>
          </>
        ) : null}
      </DetailSheet>

      <DetailSheet
        open={sheet === "agents"}
        onClose={() => setSheet(null)}
        title="Agent activity"
        eyebrow="How we checked this"
        glyph="◈"
        wide
        labelledBy="agents-sheet-title"
      >
        <ProcessTheater
          steps={steps}
          variant="compact"
          interactive
          onStepSelect={(step) => {
            setSheet(null);
            setSelectedStep(step);
          }}
          title="Outcomes"
          subtitle="Tap a stage for more"
        />
      </DetailSheet>

      <DetailSheet
        open={sheet === "tech"}
        onClose={() => setSheet(null)}
        title="Technical details"
        eyebrow="Internal"
        glyph="⚙"
        labelledBy="tech-sheet-title"
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
          <section className="stage-sheet__block">
            <p>No internal agent ids on this case. Outcomes are under Agent activity.</p>
          </section>
        )}
      </DetailSheet>

      {decisionDone ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="decision-done-title">
          <div className="modal decision-success">
            <p className="section-label">Decision recorded</p>
            <h3 id="decision-done-title">{decisionDone.label}</h3>
            <p className="muted">
              {decisionDone.nextId
                ? "Open the next invoice in the queue, or return to the case board."
                : "Queue is clear for now — back to the board when you’re ready."}
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => navigate("/desk")}
              >
                Back to desk
              </button>
              {canApprove(user) ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => navigate("/approvals")}
                >
                  Approvals queue
                </button>
              ) : null}
              {decisionDone.nextId ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const next = decisionDone.nextId;
                    setDecisionDone(null);
                    navigate(`/review/${next}`);
                  }}
                >
                  Open next{decisionDone.nextTitle ? `: ${decisionDone.nextTitle}` : ""}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => navigate("/desk")}
                >
                  Case board
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {busy ? (
        <div className="busy-overlay">
          <div className="spinner" />
        </div>
      ) : null}
    </div>
  );
}
