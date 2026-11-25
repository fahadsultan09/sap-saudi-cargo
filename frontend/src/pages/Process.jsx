import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiJson, casePath } from "../lib/api";
import { playAgentRunway, stepsAtIndex } from "../lib/agentRunway";
import { confidenceLabel, extractionConfidence } from "../lib/confidence";
import { POLL_MS, PROCESSING, UPLOAD_WATCH_MIN_MS } from "../lib/constants";
import { buildPipeline, outcomeLabel } from "../lib/pipeline";
import { clearUploadSession, loadUploadSession, saveUploadSession } from "../lib/uploadSession";
import ProcessTheater from "../components/ProcessTheater";
import StageDetailSheet from "../components/StageDetailSheet";
import DetailSheet from "../components/DetailSheet";
import "../reference-portal.css";

function finalizeSteps(row) {
  const piped = buildPipeline(row);
  return piped.map((step) => {
    if (step.key === "decide") {
      return {
        ...step,
        state: "awaiting",
        description: "Handing off to you…",
        outcome: "Ready for your decision",
        nowLabel: "Ready for you…",
      };
    }
    if (step.state === "pending" || step.state === "running") {
      return {
        ...step,
        state: "done",
        description: step.outcome || step.description,
      };
    }
    return step;
  });
}

function pickDefaultStep(steps) {
  return (
    steps.find((s) => s.state === "running") ||
    steps.find((s) => s.state === "awaiting") ||
    steps.find((s) => s.state === "failed") ||
    steps[steps.length - 1] ||
    null
  );
}

export default function Process({ showToast }) {
  const { caseId } = useParams();
  const navigate = useNavigate();
  const [caseRow, setCaseRow] = useState(null);
  const [steps, setSteps] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [detailKey, setDetailKey] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [confidenceOpen, setConfidenceOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef(null);
  const pollRef = useRef(null);
  const runwayRef = useRef(null);
  const completeRef = useRef(false);

  async function handleFileSelected(file) {
    if (!file) return;
    setUploading(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    try {
      showToast?.(`Ingesting ${file.name}…`);
      const res = await apiJson("POST", "/api/v1/cases/upload", form);
      const newId = res.case_id || res.id;
      if (newId) {
        navigate(`/process/${newId}`, { state: { fromUpload: true, fileName: file.name } });
      }
    } catch (err) {
      setError(err.message || "Upload failed");
      showToast?.(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const session = useMemo(() => loadUploadSession(), []);
  const fileName =
    caseRow?.file_name ||
    (session?.caseId === caseId ? session?.fileName : "") ||
    "";

  useEffect(() => {
    let alive = true;
    completeRef.current = false;
    clearTimeout(pollRef.current);
    runwayRef.current?.cancel();

    if (!caseId) {
      setLoading(false);
      return undefined;
    }

    async function boot() {
      setLoading(true);
      setError("");
      try {
        const row = await apiJson("GET", casePath(caseId));
        if (!alive) return;
        setCaseRow(row);
        const stillWorking = PROCESSING.includes(row.status);
        if (stillWorking) {
          setSteps(buildPipeline(row));
          startRunway(row.file_name || "");
          pollUntilDone();
        } else {
          const next = finalizeSteps(row);
          setSteps(next);
          persistComplete(row, next);
        }
      } catch (err) {
        if (!alive) return;
        setError(err.message || "Could not load this case");
        setSteps(stepsAtIndex(0, ""));
      } finally {
        if (alive) setLoading(false);
      }
    }

    function startRunway(name) {
      runwayRef.current?.cancel();
      const runway = playAgentRunway({
        fileName: name,
        minMs: UPLOAD_WATCH_MIN_MS,
        onFrame: (next) => {
          if (completeRef.current) return;
          setSteps((prev) => {
            const apiAhead = prev.filter((s) => s.state === "done" || s.state === "running").length;
            return apiAhead >= 3 ? prev : next;
          });
        },
      });
      runwayRef.current = runway;
    }

    function pollUntilDone() {
      clearTimeout(pollRef.current);
      pollRef.current = setTimeout(async () => {
        try {
          const row = await apiJson("GET", casePath(caseId));
          if (!alive) return;
          setCaseRow(row);
          if (PROCESSING.includes(row.status)) {
            pollUntilDone();
          } else {
            finishReady(row);
          }
        } catch {
          if (alive) pollUntilDone();
        }
      }, POLL_MS);
    }

    function persistComplete(row, finalSteps) {
      saveUploadSession({
        caseId: row.id,
        invoiceNumber: row.invoice_number,
        fileName: row.file_name,
        totalAmount: row.total_amount,
        currency: row.currency,
        status: row.status,
        vendor: row.supplier_name,
        completedAt: new Date().toISOString(),
        steps: finalSteps,
      });
    }

    function finishReady(row) {
      if (completeRef.current) return;
      completeRef.current = true;
      clearTimeout(pollRef.current);
      runwayRef.current?.cancel();
      const next = finalizeSteps(row);
      setCaseRow(row);
      setSteps(next);
      persistComplete(row, next);
      showToast?.("Reading finished — review when you’re ready");
    }

    boot();

    return () => {
      alive = false;
      clearTimeout(pollRef.current);
      runwayRef.current?.cancel();
    };
  }, [caseId]);

  useEffect(() => {
    if (!steps.length) return;
    setSelectedKey((prev) => {
      if (prev && steps.some((s) => s.key === prev)) return prev;
      return pickDefaultStep(steps)?.key || null;
    });
  }, [steps]);

  useEffect(() => {
    if (!detailKey) return;
    if (!steps.some((s) => s.key === detailKey)) setDetailKey(null);
  }, [steps, detailKey]);

  const selectedStep = useMemo(
    () => steps.find((s) => s.key === selectedKey) || null,
    [steps, selectedKey],
  );
  const detailStep = useMemo(
    () => (detailKey ? steps.find((s) => s.key === detailKey) || null : null),
    [steps, detailKey],
  );
  const confidence = caseRow ? extractionConfidence(caseRow) : null;
  const complete =
    caseRow && !PROCESSING.includes(caseRow.status) && steps.some((s) => s.key === "decide");
  const working = caseRow && PROCESSING.includes(caseRow.status);

  const runwayTitle = working
    ? "Agents working"
    : complete
      ? "Ready for review"
      : "Agent runway";
  const runwaySubtitle = working
    ? "Tap Details on a stage for more"
    : complete
      ? "Agents finished — review now or later"
      : "AP Console process room";

  function goReview() {
    if (!caseId) return;
    navigate(`/cases/${caseId}`, { state: { fromProcess: true } });
  }

  function reviewLater() {
    clearUploadSession();
    showToast?.("Saved for later — find it on Desk");
    navigate("/worklist");
  }

  function openStageDetails(step) {
    if (!step?.key) return;
    setSelectedKey(step.key);
    setDetailKey(step.key);
  }

  function onStepSelect(step) {
    if (!step?.key) return;
    setSelectedKey(step.key);
    if (step.key === "decide" && (complete || step.state === "awaiting")) {
      setDetailKey(step.key);
    }
  }

  return (
    <div className="ref-content" style={{ maxWidth: "1280px", margin: "0 auto", padding: "1.5rem 2rem 4rem" }}>
      {/* 1. Header Section */}
      <div className="ref-hero-card" style={{ marginBottom: "1.75rem", padding: "1.75rem 2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="ref-hero-eyebrow">WORKSPACE / INTAKE</div>
            <h1 className="ref-hero-title" style={{ fontSize: "1.75rem", margin: "0.4rem 0" }}>
              {caseId ? (fileName || caseRow?.invoice_number || "Processing Case") : "Invoice Intake & Ingestion"}
            </h1>
            <p className="ref-hero-sub" style={{ margin: 0 }}>
              {caseId
                ? `Case ID: ${caseId} · Automated Agent Runway Execution`
                : "Upload vendor invoices, credit notes, or statements to trigger automated intake, classification, and extraction."}
            </p>
          </div>
          {caseId && (
            <span
              className={`ref-status-badge ${working ? "in-progress" : complete ? "done" : "in-progress"}`}
              style={{ fontSize: "0.85rem", padding: "0.35rem 0.85rem" }}
            >
              {working ? "● Processing" : complete ? "✓ Ready for Review" : "● In Flight"}
            </span>
          )}
        </div>
      </div>

      {error ? (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "1rem", borderRadius: "10px", marginBottom: "1.5rem" }}>
          {error}
        </div>
      ) : null}

      {/* 2. Main Intake Dropzone or Live Runway */}
      {!caseId ? (
        <div>
          <div
            style={{
              background: isDragOver ? "#f0fdf4" : "#ffffff",
              border: `2px dashed ${isDragOver ? "#006937" : "#cbd5e1"}`,
              borderRadius: "16px",
              padding: "4rem 2rem",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "1.25rem",
              cursor: "pointer",
              transition: "all 0.2s ease",
              boxShadow: "0 2px 10px rgba(0, 40, 86, 0.04)",
            }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              const file = e.dataTransfer?.files?.[0];
              if (file) handleFileSelected(file);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelected(file);
              }}
            />
            <div
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "50%",
                background: "rgba(0, 105, 55, 0.1)",
                color: "var(--ref-green)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
            </div>
            <div>
              <h3 style={{ margin: "0 0 0.5rem", color: "var(--ref-navy)", fontSize: "1.35rem", fontWeight: 700 }}>
                {uploading ? "Ingesting invoice into agent runway…" : "Upload Invoices for Automated Processing"}
              </h3>
              <p style={{ margin: "0 0 0.5rem", color: "var(--ref-text-muted)", fontSize: "0.95rem" }}>
                Drag & drop single or multi-page invoice PDF or image here, or click to browse files
              </p>
              <span style={{ fontSize: "0.82rem", color: "#94a3b8" }}>
                Supported formats: PDF, PNG, JPG (up to 25 MB) · TOWER & LENS extraction will trigger automatically
              </span>
            </div>
            <button
              type="button"
              className="ref-btn-approve"
              style={{ marginTop: "0.5rem", padding: "0.6rem 1.75rem", fontSize: "0.9rem" }}
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              Select File
            </button>
          </div>

          {/* 3 Channel Info Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1.25rem", marginTop: "2rem" }}>
            <div style={{ background: "#ffffff", padding: "1.5rem", borderRadius: "12px", border: "1px solid var(--ref-line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.5rem" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--ref-green)" }}></span>
                <strong style={{ fontSize: "0.95rem", color: "var(--ref-navy)" }}>Automated Mailbox</strong>
              </div>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--ref-text-muted)", lineHeight: 1.5 }}>
                Connected to AP mailbox. 808 total emails ingested this week across Direct & Intercompany.
              </p>
            </div>

            <div style={{ background: "#ffffff", padding: "1.5rem", borderRadius: "12px", border: "1px solid var(--ref-line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.5rem" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--ref-green)" }}></span>
                <strong style={{ fontSize: "0.95rem", color: "var(--ref-navy)" }}>SAP PO Integration</strong>
              </div>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--ref-text-muted)", lineHeight: 1.5 }}>
                Real-time 2-way and 3-way line item matching with SAP PO 4200011755 and SES creation.
              </p>
            </div>

            <div style={{ background: "#ffffff", padding: "1.5rem", borderRadius: "12px", border: "1px solid var(--ref-line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.5rem" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#0284c7" }}></span>
                <strong style={{ fontSize: "0.95rem", color: "var(--ref-navy)" }}>Agent Orchestration</strong>
              </div>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--ref-text-muted)", lineHeight: 1.5 }}>
                6 specialized agents: TOWER → LENS → VECTOR → PRISM → COMPASS → PLUMB.
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* Live Case Runway */
        <div style={{ background: "#ffffff", borderRadius: "16px", padding: "2rem", border: "1px solid var(--ref-line)" }}>
          {loading && !steps.length ? (
            <div style={{ padding: "3rem", textAlign: "center", color: "var(--ref-text-muted)" }}>
              <h3>Opening process room</h3>
              <p>Loading agent runway…</p>
            </div>
          ) : (
            <div>
              <ProcessTheater
                steps={steps.length ? steps : stepsAtIndex(0, fileName || "")}
                variant="hero"
                interactive
                detailsViaHint
                onStepSelect={onStepSelect}
                onStepDetails={openStageDetails}
                title={runwayTitle}
                subtitle={
                  complete
                    ? "Agents finished — invoice is ready for your verification and approval"
                    : runwaySubtitle
                }
                selectedKey={selectedStep?.key}
              />

              {/* Bottom Actions Bar */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "2rem",
                  paddingTop: "1.5rem",
                  borderTop: "1px solid var(--ref-line)",
                }}
              >
                <div>
                  <button
                    type="button"
                    style={{ background: "transparent", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
                    onClick={() => setConfidenceOpen(true)}
                  >
                    <div style={{ fontSize: "0.75rem", color: "var(--ref-text-muted)", textTransform: "uppercase" }}>
                      Extraction Confidence
                    </div>
                    <div style={{ fontWeight: 700, color: "var(--ref-navy)", fontSize: "1rem" }}>
                      {confidence?.overall != null ? `${confidence.overall}%` : "98% High"}
                      <span style={{ color: "var(--ref-green)", marginLeft: "0.5rem", fontSize: "0.85rem" }}>
                        · Validated
                      </span>
                    </div>
                  </button>
                </div>

                <div style={{ display: "flex", gap: "1rem" }}>
                  <button
                    type="button"
                    className="ref-btn-return"
                    onClick={reviewLater}
                  >
                    Review Later
                  </button>

                  <button
                    type="button"
                    className="ref-btn-approve"
                    onClick={goReview}
                    disabled={working}
                  >
                    {complete ? "Open Case Review ›" : "Open Review"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <StageDetailSheet
        step={detailStep}
        onClose={() => setDetailKey(null)}
        actions={null}
      />

      <DetailSheet
        open={confidenceOpen}
        onClose={() => setConfidenceOpen(false)}
        title="Extraction confidence"
        eyebrow="How we scored this"
        glyph="%"
        labelledBy="process-confidence-title"
      />
    </div>
  );
}
