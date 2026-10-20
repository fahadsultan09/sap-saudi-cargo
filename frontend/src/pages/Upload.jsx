import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { apiJson, casePath } from "../lib/api";
import { canProcess, getUser } from "../lib/config";
import { confidenceLabel, extractionConfidence } from "../lib/confidence";
import { POLL_MS, PROCESS_STEPS, PROCESSING, UPLOAD_WATCH_MIN_MS } from "../lib/constants";
import { playAgentRunway, stepsAtIndex } from "../lib/agentRunway";
import { buildPipeline } from "../lib/pipeline";
import { clearUploadSession, loadUploadSession, saveUploadSession } from "../lib/uploadSession";
import ProcessTheater from "../components/ProcessTheater";
import StageDetailSheet from "../components/StageDetailSheet";

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
  const [steps, setSteps] = useState(() => {
    const saved = readRestoredSession();
    return saved && Array.isArray(saved.steps) && saved.steps.length ? saved.steps : [];
  });
  const [confidence, setConfidence] = useState(() => readRestoredSession()?.confidence || null);
  const [error, setError] = useState("");
  const [selectedStep, setSelectedStep] = useState(null);
  const pollRef = useRef(null);
  const runwayRef = useRef(null);
  const apiDoneRef = useRef(null);
  const preview = useMemo(() => idleSteps(), []);

  useEffect(() => {
    if (!canProcess(user)) {
      navigate("/");
    }
  }, [user, navigate]);

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
      setCaseId(id);
      showToast?.("Invoice received — agents spinning up");
      pollUntilDone(id);
      await runway.promise;
      const finalId = await waitForCase(id);
      finishReady(finalId || id);
    } catch (err) {
      runway.cancel();
      setError(err.message);
      setPhase("idle");
      setSteps([]);
    }
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
    setFileName("");
    setSteps([]);
    setConfidence(null);
    setError("");
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
        </div>
        {showRunway ? (
          <div className="upload-watch-meta upload-watch-meta--inline">
            <span className={`pill ${complete ? "pill-review" : "pill-working"}`}>
              {complete ? "Done" : "Live"}
            </span>
            <span className="muted">
              <strong>{fileName || "Invoice"}</strong>
              {caseId ? ` · ${caseId.slice(0, 8)}…` : ""}
            </span>
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
                <div className="upload-result__confidence" aria-label="Extraction confidence">
                  <p className="section-label">Extraction confidence</p>
                  {confidence?.hasAny ? (
                    <>
                      <div className="upload-result__score-row">
                        <strong className="upload-result__score">
                          {confidence.overall != null ? `${confidence.overall}%` : "—"}
                        </strong>
                        <span className="muted">{confidenceLabel(confidence.source)}</span>
                      </div>
                      {confidence.classification != null &&
                      confidence.source !== "classification" &&
                      confidence.classification !== confidence.overall ? (
                        <p className="upload-result__secondary muted">
                          Document type: {confidence.classification}%
                        </p>
                      ) : null}
                      {confidence.fields?.length ? (
                        <details className="upload-result__fields">
                          <summary>Per-field confidence</summary>
                          <ul>
                            {confidence.fields.map((f) => (
                              <li key={f.key}>
                                <span>{f.label}</span>
                                <strong>{f.percent}%</strong>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : (
                        <p className="upload-result__hint muted">
                          Field-level scores aren’t on this case — showing the overall figure from
                          reading.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="muted">Confidence wasn’t returned for this case.</p>
                  )}
                </div>

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
    </div>
  );
}
