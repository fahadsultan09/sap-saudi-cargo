import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { apiBlob, apiJson, casePath } from "../lib/api";
import { canApprove, canProcess, config, getUser } from "../lib/config";
import { POLL_MS } from "../lib/constants";
import { mapAuditTrail } from "../lib/history";
import {
  buildPipeline,
  formatAmount,
  mapFields,
  permissionsFor,
  pipelineProgress,
  reviewReasons,
} from "../lib/pipeline";
import DecisionModal from "../components/DecisionModal";
import DecisionSuccess from "../components/DecisionSuccess";
import InvoicePdf from "../components/InvoicePdf";
import "../reference-portal.css";

export default function Review({ userId, onUserChange, showToast }) {
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
  const [decisionDone, setDecisionDone] = useState(null);

  // Modals for reference experience
  const [showSourcesModal, setShowSourcesModal] = useState(false);
  const [showPoModal, setShowPoModal] = useState(false);
  const [showMatchingModal, setShowMatchingModal] = useState(false);
  const [showFieldsModal, setShowFieldsModal] = useState(false);

  // Agents accordion state
  const [agentOpen, setAgentOpen] = useState({
    tower: false,
    lens: false,
    vector: true,
  });

  function toggleAgent(key) {
    setAgentOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }

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

  const title = row?.invoice_number || row?.file_name || `INV-${caseId ? caseId.slice(0, 6) : "16002"}`;
  const supplier = row?.supplier_name || "Computer Diagnostic Establishment";
  const currency = row?.currency || "SAR";
  const formattedAmount = formatAmount(row?.total_amount || "7074.80", currency);

  // 13 Pipeline Stepper Nodes
  const pipeline13 = [
    { id: "received", label: "Received", phase: "intake" },
    { id: "classified", label: "Classified", phase: "intake" },
    { id: "extracted", label: "Extracted", phase: "intake" },
    { id: "checked", label: "Checked", phase: "validation" },
    { id: "first_approval", label: "First approval", phase: "validation" },
    { id: "po_matched", label: "PO matched", phase: "matching" },
    { id: "coded", label: "Coded", phase: "matching" },
    { id: "ses_created", label: "SES created", phase: "matching" },
    { id: "threeway_matched", label: "Three-way matched", phase: "matching" },
    { id: "miro_posted", label: "MIRO posted", phase: "posting" },
    { id: "vendor_reconciled", label: "Vendor reconciled", phase: "posting" },
    { id: "payment_posted", label: "Payment posted", phase: "posting" },
    { id: "paid", label: "Paid", phase: "posting" },
  ];

  // Determine current active node
  const activeStepIndex = useMemo(() => {
    if (row?.status === "APPROVED" || row?.status === "CLEARED") return 12; // Paid
    if (row?.status === "AWAITING_APPROVAL") return 8; // Three-way matched
    if (row?.status === "NEEDS_REVIEW") return 7; // SES created / current review
    if (perms.isProcessing) return 2; // Extracted
    return 7;
  }, [row?.status, perms.isProcessing]);

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
        showToast?.("Fields updated");
        await load();
      } else {
        const payload = { action: current.kind };
        if (text) payload.comment = text;
        const res = await apiJson("POST", `${casePath(caseId)}/decision`, payload);
        setDecisionDone(res || { action: current.kind });
        showToast?.(`Invoice ${current.kind}d`);
      }
    } catch (err) {
      setError(err.message || "Action failed");
      showToast?.(err.message || "Action failed");
    } finally {
      setBusy(false);
    }
  }

  function handleSaveFields() {
    const changes = {};
    fields.forEach((f) => {
      const val = String(f.value || "").trim();
      if (val !== f.original) changes[f.key] = val;
    });
    if (!Object.keys(changes).length) {
      showToast?.("No changes to save");
      return;
    }
    setModal({
      kind: "fields",
      title: "Save corrections",
      label: "What did you correct and why?",
      placeholder: "e.g. Verified quantity against purchase order",
      submitText: "Save",
      minLength: 0,
      payload: changes,
    });
    setShowFieldsModal(false);
  }

  return (
    <div className="ref-case-page">
      {/* 1. Breadcrumbs */}
      <nav className="ref-crumb-bar" aria-label="Breadcrumb">
        <Link to="/worklist" className="ref-crumb-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
          Direct Invoices
        </Link>
        <span className="ref-crumb-sep">/</span>
        <span className="ref-crumb-current">{title}</span>
      </nav>

      {/* 2. Case Header Card */}
      <section className="ref-case-header-card">
        <div className="ref-case-header-top">
          <div>
            <div className="ref-case-title-row">
              <h1 className="ref-case-title">{supplier}</h1>
              {reasons.length > 0 ? (
                <span className="ref-quiet-pill amber">
                  <i></i>Needs Review
                </span>
              ) : (
                <span className="ref-quiet-pill">
                  <i></i>Nothing on you.
                </span>
              )}
            </div>
            <div className="ref-case-ref-info">
              {title} · Owner: Awaiting assignment (AP Supervisor)
            </div>
          </div>

          <div className="ref-case-amount-block">
            <div className="ref-case-amount">{formattedAmount}</div>
          </div>
        </div>

        {/* Live Processing Banner (shown while agents are actively executing or newly uploaded) */}
        {(perms.isProcessing || row?.status === "RECEIVED" || row?.status === "EXTRACTING") && (
          <div className="ref-live-processing-banner">
            <div className="ref-live-processing-row">
              <div className="ref-live-processing-left">
                <div className="ref-live-processing-spinner"></div>
                <div className="ref-live-processing-text">
                  <strong>Agents Active:</strong> TOWER & LENS are extracting document fields and VECTOR is verifying SAP PO matching...
                </div>
              </div>
              <span className="ref-case-agent-pill working">
                <i></i>Live Runway
              </span>
            </div>
            <div className="ref-live-progress-track">
              <div className="ref-live-progress-fill"></div>
            </div>
          </div>
        )}

        {/* 3. Horizontal 13-Step Stepper */}
        <div className="ref-journey-stepper" style={{ "--n": 13 }}>
          <div className="ref-stepper-groups" aria-hidden="true">
            <span className={`ref-stepper-group ${activeStepIndex <= 2 ? "active" : ""}`} style={{ gridColumn: "span 3" }}>
              Intake
            </span>
            <span className={`ref-stepper-group ${activeStepIndex > 2 && activeStepIndex <= 4 ? "active" : ""}`} style={{ gridColumn: "span 2" }}>
              Validation
            </span>
            <span className={`ref-stepper-group ${activeStepIndex > 4 && activeStepIndex <= 8 ? "active" : ""}`} style={{ gridColumn: "span 4" }}>
              Matching
            </span>
            <span className={`ref-stepper-group ${activeStepIndex > 8 ? "active" : ""}`} style={{ gridColumn: "span 4" }}>
              Posting & payment
            </span>
          </div>

          <ol className="ref-stepper-bar">
            {pipeline13.map((node, idx) => {
              const isDone = idx < activeStepIndex;
              const isCurrent = idx === activeStepIndex;
              const isAmber = isCurrent && reasons.length > 0;
              const statusClass = isAmber ? "amber" : isCurrent ? "current" : isDone ? "done" : "";

              return (
                <li key={node.id} className={statusClass}>
                  <span className="ref-stepper-dot"></span>
                  <span className="ref-stepper-label">{node.label}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* 4. Invoice Journey Accordion Card */}
      <section className="ref-case-journey-card">
        <div className="ref-case-journey-head">
          <h2 className="ref-case-journey-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--apex-brand)" }}>
              <circle cx="6" cy="19" r="2.5"></circle>
              <circle cx="18" cy="5" r="2.5"></circle>
              <path d="M8.5 19H17a3.5 3.5 0 0 0 0-7H7a3.5 3.5 0 0 1 0-7h8.5"></path>
            </svg>
            Invoice Journey
          </h2>

          <button
            type="button"
            className="ref-source-chip-btn"
            onClick={() => setShowSourcesModal(true)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            <span>View Sources</span>
          </button>
        </div>

        <ul className="ref-case-agents-list">
          {/* Agent 1: Tower */}
          <li className="ref-case-agent-row done">
            <div className="ref-case-agent-track">
              <div className="ref-case-agent-circle">
                T
                <span className="ref-case-ok-badge">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </span>
              </div>
              <div className="ref-case-agent-stem"></div>
            </div>

            <div className="ref-case-agent-content">
              <div className="ref-case-agent-header-row">
                <button
                  type="button"
                  className="ref-case-agent-btn"
                  onClick={() => toggleAgent("tower")}
                >
                  Tower
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ transform: agentOpen.tower ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
                    <polyline points="9 6 15 12 9 18"></polyline>
                  </svg>
                </button>
                <span className="ref-case-agent-pill processed">
                  <i></i>Processed
                </span>
              </div>
              {agentOpen.tower && (
                <div style={{ fontSize: "0.85rem", color: "var(--ref-text-muted)", padding: "0.5rem 0" }}>
                  Classified as Direct Supplier Invoice. Ingestion channel: AP Mailbox. Confidence: 99%.
                </div>
              )}
            </div>
          </li>

          {/* Agent 2: Lens */}
          <li className="ref-case-agent-row done">
            <div className="ref-case-agent-track">
              <div className="ref-case-agent-circle">
                L
                <span className="ref-case-ok-badge">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </span>
              </div>
              <div className="ref-case-agent-stem"></div>
            </div>

            <div className="ref-case-agent-content">
              <div className="ref-case-agent-header-row">
                <button
                  type="button"
                  className="ref-case-agent-btn"
                  onClick={() => toggleAgent("lens")}
                >
                  Lens
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ transform: agentOpen.lens ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
                    <polyline points="9 6 15 12 9 18"></polyline>
                  </svg>
                </button>
                <span className="ref-case-agent-pill processed">
                  <i></i>Processed
                </span>
              </div>
              {agentOpen.lens && (
                <div style={{ fontSize: "0.85rem", color: "var(--ref-text-muted)", padding: "0.5rem 0" }}>
                  Document OCR & Entity extraction complete. Extracted 8 header fields and 3 line items with high confidence.
                </div>
              )}
            </div>
          </li>

          {/* Agent 3: Vector */}
          <li className="ref-case-agent-row done">
            <div className="ref-case-agent-track">
              <div className="ref-case-agent-circle working">
                V
              </div>
              <div className="ref-case-agent-stem"></div>
            </div>

            <div className="ref-case-agent-content">
              <div className="ref-case-agent-header-row">
                <button
                  type="button"
                  className="ref-case-agent-btn"
                  onClick={() => toggleAgent("vector")}
                >
                  Vector
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ transform: agentOpen.vector ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
                    <polyline points="9 6 15 12 9 18"></polyline>
                  </svg>
                </button>
                <span className="ref-case-agent-pill working">
                  <i></i>Working
                </span>
              </div>

              {agentOpen.vector && (
                <div className="ref-case-substeps">
                  {/* Step 1: First Approval */}
                  <div className="ref-case-substep-row">
                    <span className="ref-substep-tick">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    </span>
                    <span className="ref-substep-key">First approval</span>
                    <span className="ref-substep-text">
                      First-level approval not required: vendor 1101069 is not on the approval matrix
                    </span>
                  </div>

                  {/* Step 2: PO Lookup */}
                  <div className="ref-case-substep-row">
                    <span className="ref-substep-tick">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    </span>
                    <span className="ref-substep-key">PO lookup</span>
                    <span className="ref-substep-text">
                      PO looked up from SAP, found PO number {row?.po_number || "4200011755"}
                    </span>
                    <button
                      type="button"
                      className="ref-substep-cta"
                      onClick={() => setShowPoModal(true)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      </svg>
                      View PO details ›
                    </button>
                  </div>

                  {/* Step 3: PO Request */}
                  <div className="ref-case-substep-row">
                    <span className="ref-substep-tick">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    </span>
                    <span className="ref-substep-key">PO request</span>
                    <span className="ref-substep-text">
                      PO {row?.po_number || "4200011755"} found in SAP; no request to the Operations department needed
                    </span>
                  </div>

                  {/* Step 4: G/L & Matching */}
                  <div className="ref-case-substep-row">
                    <span className="ref-substep-tick">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    </span>
                    <span className="ref-substep-key">G/L & matching</span>
                    <span className="ref-substep-text">
                      System matched 3 invoice lines to PO lines and coded them to G/L · AP may review the line mapping
                    </span>
                    <button
                      type="button"
                      className="ref-substep-cta"
                      onClick={() => setShowMatchingModal(true)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="8" y1="6" x2="21" y2="6"></line>
                        <line x1="8" y1="12" x2="21" y2="12"></line>
                        <line x1="8" y1="18" x2="21" y2="18"></line>
                      </svg>
                      View matching ›
                    </button>
                  </div>

                  {/* Step 5: SES Lookup */}
                  <div className="ref-case-substep-row">
                    <span className="ref-substep-tick pending"></span>
                    <span className="ref-substep-key">SES lookup</span>
                    <span className="ref-substep-text" style={{ color: "var(--ref-text-muted)" }}>
                      Not reached yet
                    </span>
                  </div>

                  {/* Step 6: SES Request */}
                  <div className="ref-case-substep-row">
                    <span className="ref-substep-tick pending"></span>
                    <span className="ref-substep-key">SES request</span>
                    <span className="ref-substep-text" style={{ color: "var(--ref-text-muted)" }}>
                      Not reached yet
                    </span>
                  </div>
                </div>
              )}
            </div>
          </li>

          {/* 5. Later Row: Next Prism > Compass > Plumb > Miro Posting */}
          <li className="ref-case-later-row">
            <div className="ref-later-nodes" aria-hidden="true">
              <span className="ref-later-node">Pr</span>
              <span className="ref-later-node">C</span>
              <span className="ref-later-node">P</span>
              <span className="ref-later-node">M</span>
            </div>
            <div className="ref-later-text">
              <span className="ref-later-key">Next</span>
              <span>Prism › Compass › Plumb › Miro Posting</span>
              <span className="ref-case-agent-pill grey">
                <i></i>Not reached yet
              </span>
            </div>
          </li>
        </ul>
      </section>

      {/* 5. Sticky Bottom Decision Action Bar */}
      <footer className="ref-decision-bar">
        <div className="ref-decision-info">
          <div className="ref-decision-role-wrap">
            <span>AP Role:</span>
            <span className="ref-decision-role-badge">{user?.roleLabel || "Processor"}</span>
          </div>
          <span className="ref-decision-sep">|</span>
          <div className={`ref-decision-status-text ${reasons.length > 0 ? "has-attention" : ""}`}>
            {reasons.length > 0 && <span className="ref-decision-pulse-dot" />}
            <span>
              {reasons.length > 0 ? `${reasons.length} checks need attention` : "Ready for processor review"}
            </span>
          </div>
        </div>

        <div className="ref-decision-btns">
          <button
            type="button"
            className="ref-btn-edit"
            onClick={() => setShowFieldsModal(true)}
          >
            Edit Fields ({fields.length})
          </button>

          {canProcess(user) && (
            <button
              type="button"
              className="ref-btn-return"
              onClick={() =>
                setModal({
                  kind: "return",
                  title: "Send back invoice",
                  label: "Reason for sending back",
                  placeholder: "e.g. Missing department code or PO correction required",
                  submitText: "Send Back",
                  minLength: 3,
                })
              }
            >
              Send Back
            </button>
          )}

          {canApprove(user) && (
            <button
              type="button"
              className="ref-btn-reject"
              onClick={() =>
                setModal({
                  kind: "reject",
                  title: "Reject invoice",
                  label: "Why is this invoice rejected?",
                  placeholder: "e.g. Duplicate submission or incorrect billing entity",
                  submitText: "Reject",
                  minLength: 3,
                })
              }
            >
              Reject
            </button>
          )}

          <button
            type="button"
            className="ref-btn-approve"
            onClick={() =>
              setModal({
                kind: "approve",
                title: "Approve invoice",
                label: "Comment (optional)",
                placeholder: "Add an approval note for the audit trail",
                submitText: "Approve Invoice",
                minLength: 0,
              })
            }
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Approve
          </button>
        </div>
      </footer>

      {/* ====================================================================
          MODALS
          ==================================================================== */}

      {/* 1. View Sources Modal (Original Invoice PDF & Email) */}
      {showSourcesModal && (
        <div className="ref-modal-overlay" onClick={() => setShowSourcesModal(false)}>
          <div className="ref-modal-box" style={{ width: "950px" }} onClick={(e) => e.stopPropagation()}>
            <div className="ref-modal-header">
              <h3 className="ref-modal-title">Source Documents & Ingestion</h3>
              <button
                type="button"
                className="ref-modal-close-btn"
                onClick={() => setShowSourcesModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="ref-modal-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
              <div>
                <h4 style={{ margin: "0 0 0.75rem", color: "var(--ref-navy)", fontSize: "0.95rem" }}>
                  Original PDF Document
                </h4>
                {pdfUrl ? (
                  <InvoicePdf blobUrl={pdfUrl} fileName={row?.file_name} />
                ) : (
                  <div style={{ padding: "3rem", textAlign: "center", background: "#f8fafc", borderRadius: "8px", border: "1px dashed #cbd5e1" }}>
                    <p style={{ margin: 0, color: "var(--ref-text-muted)" }}>{pdfError || "Document preview available in SAP"}</p>
                  </div>
                )}
              </div>

              <div>
                <h4 style={{ margin: "0 0 0.75rem", color: "var(--ref-navy)", fontSize: "0.95rem" }}>
                  Mailbox Ingestion Details
                </h4>
                <div style={{ background: "#f8fafc", borderRadius: "10px", padding: "1.25rem", border: "1px solid var(--ref-line)" }}>
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
                    <strong>From:</strong> billing@{supplier.toLowerCase().replace(/\s+/g, "")}.com
                  </p>
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
                    <strong>To:</strong> ap-invoices@company.com
                  </p>
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
                    <strong>Subject:</strong> Tax Invoice {title} - {supplier}
                  </p>
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
                    <strong>Date:</strong> {row?.created_at ? new Date(row.created_at).toLocaleString() : "25 Nov 2026, 10:14 AM"}
                  </p>
                  <hr style={{ border: 0, borderTop: "1px solid var(--ref-line)", margin: "0.85rem 0" }} />
                  <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--ref-text-muted)", lineHeight: 1.5 }}>
                    Dear Accounts Payable Team,<br /><br />
                    Please find attached our tax invoice {title} for computer diagnostic and IT infrastructure support services rendered.
                    PO reference: {row?.po_number || "4200011755"}.<br /><br />
                    Thank you,<br />
                    Accounts Receivable
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. View PO Details Modal */}
      {showPoModal && (
        <div className="ref-modal-overlay" onClick={() => setShowPoModal(false)}>
          <div className="ref-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="ref-modal-header">
              <h3 className="ref-modal-title">SAP Purchase Order Details</h3>
              <button
                type="button"
                className="ref-modal-close-btn"
                onClick={() => setShowPoModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="ref-modal-body">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "1.5rem", background: "#f8fafc", padding: "1rem", borderRadius: "8px" }}>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "var(--ref-text-muted)", textTransform: "uppercase" }}>PO Number</div>
                  <div style={{ fontWeight: 700, color: "var(--ref-navy)" }}>{row?.po_number || "4200011755"}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "var(--ref-text-muted)", textTransform: "uppercase" }}>Company Code</div>
                  <div style={{ fontWeight: 700, color: "var(--ref-navy)" }}>{row?.company_code || "1000"}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "var(--ref-text-muted)", textTransform: "uppercase" }}>Vendor Code</div>
                  <div style={{ fontWeight: 700, color: "var(--ref-navy)" }}>1101069</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "var(--ref-text-muted)", textTransform: "uppercase" }}>Status</div>
                  <div style={{ fontWeight: 700, color: "var(--ref-green)" }}>Released in SAP</div>
                </div>
              </div>

              <h4 style={{ margin: "0 0 0.75rem", color: "var(--ref-navy)", fontSize: "0.95rem" }}>PO Line Items</h4>
              <table className="ref-data-table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Description</th>
                    <th style={{ textAlign: "right" }}>Quantity</th>
                    <th style={{ textAlign: "right" }}>Unit Price</th>
                    <th style={{ textAlign: "right" }}>Net Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>10</td>
                    <td>Hardware Maintenance & Diagnostic Service</td>
                    <td style={{ textAlign: "right" }}>1 AU</td>
                    <td style={{ textAlign: "right" }}>3,500.00 SAR</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>3,500.00 SAR</td>
                  </tr>
                  <tr>
                    <td>20</td>
                    <td>Network Interface Configuration</td>
                    <td style={{ textAlign: "right" }}>2 EA</td>
                    <td style={{ textAlign: "right" }}>1,326.00 SAR</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>2,652.00 SAR</td>
                  </tr>
                  <tr>
                    <td>30</td>
                    <td>Diagnostic Reporting & Documentation</td>
                    <td style={{ textAlign: "right" }}>1 AU</td>
                    <td style={{ textAlign: "right" }}>922.80 SAR</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>922.80 SAR</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 3. View Matching Modal */}
      {showMatchingModal && (
        <div className="ref-modal-overlay" onClick={() => setShowMatchingModal(false)}>
          <div className="ref-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="ref-modal-header">
              <h3 className="ref-modal-title">3-Way Line Matching & G/L Coding</h3>
              <button
                type="button"
                className="ref-modal-close-btn"
                onClick={() => setShowMatchingModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="ref-modal-body">
              <p style={{ margin: "0 0 1.25rem", fontSize: "0.88rem", color: "var(--ref-text-muted)" }}>
                Vector matched 3 invoice lines with SAP Purchase Order <strong>{row?.po_number || "4200011755"}</strong>. Quantities and unit prices are within 0.00% variance tolerance.
              </p>

              <table className="ref-data-table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Invoice Description</th>
                    <th>Matched PO Item</th>
                    <th style={{ textAlign: "right" }}>Invoiced</th>
                    <th style={{ textAlign: "right" }}>PO Qty</th>
                    <th>Status</th>
                    <th>G/L Account</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>1</td>
                    <td>Hardware Maintenance & Diagnostic Service</td>
                    <td>Item 10</td>
                    <td style={{ textAlign: "right" }}>1</td>
                    <td style={{ textAlign: "right" }}>1</td>
                    <td>
                      <span className="ref-quiet-pill"><i></i>Matched</span>
                    </td>
                    <td><strong>642010</strong> (IT Service)</td>
                  </tr>
                  <tr>
                    <td>2</td>
                    <td>Network Interface Configuration</td>
                    <td>Item 20</td>
                    <td style={{ textAlign: "right" }}>2</td>
                    <td style={{ textAlign: "right" }}>2</td>
                    <td>
                      <span className="ref-quiet-pill"><i></i>Matched</span>
                    </td>
                    <td><strong>642010</strong> (IT Service)</td>
                  </tr>
                  <tr>
                    <td>3</td>
                    <td>Diagnostic Reporting & Documentation</td>
                    <td>Item 30</td>
                    <td style={{ textAlign: "right" }}>1</td>
                    <td style={{ textAlign: "right" }}>1</td>
                    <td>
                      <span className="ref-quiet-pill"><i></i>Matched</span>
                    </td>
                    <td><strong>642010</strong> (IT Service)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 4. Edit Fields Modal */}
      {showFieldsModal && (
        <div className="ref-modal-overlay" onClick={() => setShowFieldsModal(false)}>
          <div className="ref-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="ref-modal-header">
              <h3 className="ref-modal-title">Extracted Invoice Fields</h3>
              <button
                type="button"
                className="ref-modal-close-btn"
                onClick={() => setShowFieldsModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="ref-modal-body">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
                {fields.map((f) => (
                  <div key={f.key}>
                    <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 700, color: "var(--ref-navy)", marginBottom: "4px" }}>
                      {f.label} {f.required && <span style={{ color: "#ef4444" }}>*</span>}
                    </label>
                    <input
                      type="text"
                      value={f.value || ""}
                      onChange={(e) =>
                        setFields((prev) =>
                          prev.map((item) => (item.key === f.key ? { ...item, value: e.target.value } : item))
                        )
                      }
                      style={{
                        width: "100%",
                        padding: "0.55rem 0.75rem",
                        borderRadius: "8px",
                        border: "1px solid var(--ref-line-strong)",
                        fontSize: "0.88rem",
                        color: "var(--ref-navy)",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
                <button
                  type="button"
                  className="ref-btn-edit"
                  onClick={() => setShowFieldsModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ref-btn-approve"
                  onClick={handleSaveFields}
                >
                  Save Corrections
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Decision Confirmation Modal */}
      {modal && (
        <DecisionModal
          modal={modal}
          onClose={() => setModal(null)}
          onSubmit={onModalSubmit}
          busy={busy}
        />
      )}

      {/* 6. Decision Success Banner */}
      {decisionDone && (
        <DecisionSuccess
          decision={decisionDone}
          onClose={() => setDecisionDone(null)}
          onNext={() => navigate("/worklist")}
        />
      )}
    </div>
  );
}
