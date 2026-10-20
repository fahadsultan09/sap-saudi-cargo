import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { apiJson, casePath } from "../lib/api";
import { canProcess, getUser } from "../lib/config";
import { confidenceLabel, extractionConfidence } from "../lib/confidence";
import { POLL_MS, PROCESS_STEPS, PROCESSING, UPLOAD_WATCH_MIN_MS } from "../lib/constants";
import { playAgentRunway, stepsAtIndex } from "../lib/agentRunway";
import { buildPipeline, formatDateTime, outcomeLabel } from "../lib/pipeline";
import { clearUploadSession, loadUploadSession, saveUploadSession } from "../lib/uploadSession";
import { takePendingFile } from "../lib/pendingUpload";
import ProcessTheater from "../components/ProcessTheater";
import StageDetailSheet from "../components/StageDetailSheet";
import DetailSheet from "../components/DetailSheet";
import DuplicateDialog from "../components/DuplicateDialog";

function idleSteps() {
  return PROCESS_STEPS.map((s) => ({
    key: s.key,
    title: s.title,
    description: s.plain,
    outcome: s.outcome || s.plain,
    actions: [],
    nowLabel: "",
    state: "pending",
    agent: s.agent || "",
    codename: s.codename || "",
    role: s.role || "",
    glyph: s.glyph || "●",
  }));
}

function finalizeSteps(row) {
  const piped = buildPipeline(row);
  return piped.map((step) => {
    if (step.key === "decide") {
      return {
        ...step,
        state: "running",
        description: "Ready for you to review",
        outcome: "Ready for your decision",
        nowLabel: "Open the staged invoice",
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

function readRestoredSession() {
  const saved = loadUploadSession();
  if (!saved || saved.phase !== "complete" || !saved.caseId) return null;
  return saved;
}

export default function Upload({ userId, showToast }) {
  const navigate = useNavigate();
  const user = getUser(userId);
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState(() => (readRestoredSession() ? "complete" : "idle")); // idle | watching | complete
  const [fileName, setFileName] = useState(() => readRestoredSession()?.fileName || "");
  const [caseId, setCaseId] = useState(() => readRestoredSession()?.caseId || "");
  const [caseRow, setCaseRow] = useState(null);
  const [steps, setSteps] = useState(() => {
    const saved = readRestoredSession();
    return saved && Array.isArray(saved.steps) && saved.steps.length ? saved.steps : [];
  });
  const [confidence, setConfidence] = useState(() => readRestoredSession()?.confidence || null);
  const [error, setError] = useState("");
  const [selectedStep, setSelectedStep] = useState(null);
  const [detail, setDetail] = useState(null); // confidence | case
  const [duplicate, setDuplicate] = useState(null);
  const pollRef = useRef(null);
  const runwayRef = useRef(null);
  const apiDoneRef = useRef(null);
  const preview = useMemo(() => idleSteps(), []);

  useEffect(() => {
    if (!canProcess(user)) {
      navigate("/");
    }
  }, [user, navigate]);

  useEffect(() => {
    const pending = takePendingFile();
    if (pending) uploadFile(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handoff once on mount
  }, []);

  useEffect(
    () => () => {
      clearTimeout(pollRef.current);
      runwayRef.current?.cancel();
    },
    [],
  );

  function persistComplete({ id, name, nextSteps, conf }) {
    saveUploadSession({
      caseId: id,
      fileName: name,
      steps: nextSteps,
      confidence: conf,
      phase: "complete",
    });
  }

  function goToReview(id = caseId) {
    if (!id) return;
    navigate(`/review/${id}`, { state: { fromUpload: true, caseId: id } });
  }

  function onStepSelect(step) {
    if (phase === "complete" && step?.key === "decide") {
      goToReview();
      return;
    }
    setSelectedStep(step);
  }

  async function uploadFile(file) {
    if (!file) return;
    setError("");
    setFileName(file.name);
    setPhase("watching");
    setConfidence(null);
    setCaseId("");
    setCaseRow(null);
    setSteps(stepsAtIndex(0, file.name));
    apiDoneRef.current = null;
    clearUploadSession();

    runwayRef.current?.cancel();
    const runway = playAgentRunway({
      fileName: file.name,
      minMs: UPLOAD_WATCH_MIN_MS,
      onFrame: (next) => {
        if (apiDoneRef.current?.stillWorking) return;
        setSteps(next);
      },
    });
    runwayRef.current = runway;

    const form = new FormData();
    form.append("file", file);

    try {
      const result = await apiJson("POST", "/api/v1/cases/upload", form);
      const id = result.case_id || result.id;
      const dupIds = result.possible_duplicate_case_ids || [];
      const existingId =
        (result.duplicate && id) ||
        result.existing_case_id ||
        (Array.isArray(dupIds) && dupIds[0]) ||
        null;

      if (result.duplicate && id) {
        runway.cancel();
        setPhase("idle");
        setSteps([]);
        setDuplicate({
          mode: "existing",
          fileName: file.name,
          caseId: id,
          status: result.status,
        });
        return;
      }

      if (existingId && Array.isArray(dupIds) && dupIds.length) {
        runway.cancel();
        setPhase("idle");
        setSteps([]);
        setCaseId(id);
        setDuplicate({
          mode: "possible",
          fileName: file.name,
          caseId: existingId,
          newCaseId: id,
          status: result.status,
        });
        return;
      }

      setCaseId(id);
      showToast?.("Invoice received — agents spinning up");
      pollUntilDone(id);
      await runway.promise;
      const finalId = await waitForCase(id);
      finishReady(finalId || id);
    } catch (err) {
      runway.cancel();
      const body = err?.body;
      const existing =
        body?.existing_case_id ||
        body?.case_id ||
        body?.error?.existing_case_id ||
        null;
      if (err?.status === 409 || body?.duplicate || existing) {
        setDuplicate({
          mode: "existing",
          fileName: file.name,
          caseId: existing || body?.case_id,
          status: body?.status,
        });
        setPhase("idle");
        setSteps([]);
        return;
      }
      setError(err.message);
      setPhase("idle");
      setSteps([]);
    }
  }

  function continueAfterDuplicate() {
    const newId = duplicate?.newCaseId;
    setDuplicate(null);
    if (!newId) return;
    // Agentic marks SHA duplicates as NEEDS_REVIEW without re-running agents.
    goToReview(newId);
  }

  function waitForCase(id) {
    if (apiDoneRef.current && !apiDoneRef.current.stillWorking) {
      return Promise.resolve(id);
    }
    return new Promise((resolve) => {
      const check = () => {
        if (apiDoneRef.current && !apiDoneRef.current.stillWorking) {
          resolve(id);
          return;
        }
        pollRef.current = setTimeout(check, 200);
      };
      check();
    });
  }

  function pollUntilDone(id) {
    clearTimeout(pollRef.current);
    pollRef.current = setTimeout(async () => {
      try {
        const row = await apiJson("GET", casePath(id));
        const stillWorking = PROCESSING.includes(row.status);
        apiDoneRef.current = { stillWorking, row };
        setCaseRow(row);
        if (stillWorking) {
          setSteps(buildPipeline(row));
          pollUntilDone(id);
        } else {
          const piped = buildPipeline(row);
          if (piped.some((s) => s.state === "done")) {
            setSteps((prev) => {
              const runwayAhead = prev.filter((s) => s.state === "running" || s.state === "done").length;
              return runwayAhead >= 3 ? prev : piped;
            });
          }
        }
      } catch (err) {
        setError(err.message);
        setPhase("idle");
        runwayRef.current?.cancel();
      }
    }, POLL_MS);
  }

  function finishReady(id) {
    clearTimeout(pollRef.current);
    const row = apiDoneRef.current?.row;
    const nextSteps = row ? finalizeSteps(row) : stepsAtIndex(PROCESS_STEPS.length - 1, fileName);
    const conf = row ? extractionConfidence(row) : null;
    setSteps(nextSteps);
    setConfidence(conf);
    setCaseId(id);
    if (row) setCaseRow(row);
    setPhase("complete");
    persistComplete({ id, name: fileName || row?.file_name || "", nextSteps, conf });
    showToast?.("Reading finished — review when you’re ready");
  }

  function onDrop(e) {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  function startAnother() {
    setPhase("idle");
    setCaseId("");
    setCaseRow(null);
    setFileName("");
    setSteps([]);
    setConfidence(null);
    setError("");
    setDetail(null);
    clearUploadSession();
  }

  const watching = phase === "watching";
  const complete = phase === "complete";
  const showRunway = watching || complete;

  return (
    <div className="page-enter">
      <section className="home-strip home-strip--upload" aria-label="Upload">
        <div>
          <p className="section-label" style={{ marginBottom: "0.2rem" }}>
            Upload
          </p>
          <strong className="home-strip__title">
            {watching ? "Agents at work" : complete ? "Ready for your review" : "Drop an invoice"}
          </strong>
          <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
            Or open the <Link to="/desk">case board</Link> anytime.
          </p>
        </div>
        {showRunway ? (
          <div className="upload-watch-meta upload-watch-meta--inline">
            <button
              type="button"
              className={`pill pill-clickable ${complete ? "pill-review" : "pill-working"}`}
              onClick={() => setDetail("status")}
              aria-label="Open status details"
            >
              {complete ? "Done" : "Live"}
            </button>
            <button
              type="button"
              className="meta-chip"
              onClick={() => setDetail("case")}
              aria-label="Open case details"
            >
              <strong>{fileName || "Invoice"}</strong>
              {caseId ? ` · ${caseId.slice(0, 8)}…` : ""}
            </button>
          </div>
        ) : null}
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <AnimatePresence mode="wait">
        {!showRunway ? (
          <motion.div
            key="drop"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.4 }}
          >
            <div className="home-runway" style={{ marginBottom: "1.15rem" }}>
              <ProcessTheater
                steps={preview}
                variant="hero"
                interactive
                onStepSelect={setSelectedStep}
                title="Agent runway"
                subtitle="Standing by — drop a PDF and they light up"
              />
            </div>
            <label
              className={`dropzone${drag ? " drag" : ""}`}
              onDragEnter={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
            >
              <div>
                <h2>Drop PDF here</h2>
                <p>or click to choose a file</p>
              </div>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => uploadFile(e.target.files?.[0])}
              />
            </label>
          </motion.div>
        ) : (
          <motion.div
            key="theater"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45 }}
            className="home-runway"
          >
            <ProcessTheater
              steps={steps}
              variant="hero"
              interactive
              onStepSelect={onStepSelect}
              title="Agent runway"
              subtitle={
                complete
                  ? "Agents finished — tap Your review or open the invoice below"
                  : "Tap a stage for details — live actions rotate while each agent works"
              }
            />

            {complete ? (
              <motion.div
                className="upload-result"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.4 }}
              >
                <button
                  type="button"
                  className="upload-result__confidence upload-result__confidence--clickable"
                  aria-label="How confidence was derived"
                  onClick={() => setDetail("confidence")}
                >
                  <p className="section-label">Extraction confidence</p>
                  {confidence?.hasAny ? (
                    <div className="upload-result__score-row">
                      <strong className="upload-result__score">
                        {confidence.overall != null ? `${confidence.overall}%` : "—"}
                      </strong>
                      <span className="muted">
                        {confidenceLabel(confidence.source)} · tap for how
                      </span>
                    </div>
                  ) : (
                    <p className="muted">Confidence wasn’t returned — tap for details</p>
                  )}
                </button>

                <div className="upload-result__actions btn-row">
                  <button type="button" className="btn btn-primary" onClick={() => goToReview()}>
                    Review invoice
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={startAnother}>
                    Upload another
                  </button>
                </div>
              </motion.div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>

      <StageDetailSheet
        step={selectedStep}
        onClose={() => setSelectedStep(null)}
        actions={
          complete && selectedStep?.key === "decide" ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setSelectedStep(null);
                goToReview();
              }}
            >
              Review invoice
            </button>
          ) : null
        }
      />

      <DetailSheet
        open={detail === "confidence"}
        onClose={() => setDetail(null)}
        title="Extraction confidence"
        eyebrow="How we scored this"
        glyph="%"
        labelledBy="confidence-sheet-title"
        actions={
          caseId ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setDetail(null);
                goToReview();
              }}
            >
              Review invoice
            </button>
          ) : null
        }
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
            <h3>Not available</h3>
            <p>Confidence wasn’t returned for this case. You can still open the invoice and check fields against the PDF.</p>
          </section>
        )}
      </DetailSheet>

      <DetailSheet
        open={detail === "case" || detail === "status"}
        onClose={() => setDetail(null)}
        title={detail === "status" ? "Status" : "Case"}
        eyebrow={fileName || "Invoice"}
        glyph={detail === "status" ? "●" : "#"}
        labelledBy="upload-case-sheet-title"
        actions={
          complete && caseId ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setDetail(null);
                goToReview();
              }}
            >
              Review invoice
            </button>
          ) : null
        }
      >
        <section className="stage-sheet__block">
          <h3>Case id</h3>
          <p>
            <code className="detail-code">{caseId || "—"}</code>
          </p>
        </section>
        <section className="stage-sheet__block">
          <h3>Status</h3>
          <p>
            {complete
              ? outcomeLabel(caseRow?.status) || "Ready for review"
              : "Agents are still reading this invoice"}
          </p>
        </section>
        <section className="stage-sheet__block">
          <h3>File</h3>
          <p>{fileName || caseRow?.file_name || "—"}</p>
        </section>
        {caseRow?.created_at || caseRow?.updated_at ? (
          <section className="stage-sheet__block">
            <h3>Timestamps</h3>
            <ul className="detail-kv">
              {caseRow.created_at ? (
                <li>
                  <span>Created</span>
                  <strong>{formatDateTime(caseRow.created_at)}</strong>
                </li>
              ) : null}
              {caseRow.updated_at ? (
                <li>
                  <span>Updated</span>
                  <strong>{formatDateTime(caseRow.updated_at)}</strong>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}
      </DetailSheet>

      <DuplicateDialog
        open={Boolean(duplicate)}
        mode={duplicate?.mode}
        fileName={duplicate?.fileName}
        caseId={duplicate?.caseId}
        status={duplicate?.status}
        onOpenExisting={() => {
          const id = duplicate?.caseId;
          setDuplicate(null);
          if (id) goToReview(id);
        }}
        onContinue={continueAfterDuplicate}
        onDismiss={() => setDuplicate(null)}
      />
    </div>
  );
}
