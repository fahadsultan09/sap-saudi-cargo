import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { apiJson, casePath } from "../lib/api";
import { playAgentRunway, stepsAtIndex } from "../lib/agentRunway";
import { confidenceLabel, extractionConfidence } from "../lib/confidence";
import { POLL_MS, PROCESSING, UPLOAD_WATCH_MIN_MS } from "../lib/constants";
import { buildPipeline, outcomeLabel } from "../lib/pipeline";
import { clearUploadSession, loadUploadSession, saveUploadSession } from "../lib/uploadSession";
import ProcessTheater from "../components/ProcessTheater";
import StageDetailSheet from "../components/StageDetailSheet";
import DetailSheet from "../components/DetailSheet";

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
  const pollRef = useRef(null);
  const runwayRef = useRef(null);
  const completeRef = useRef(false);

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
      setError("Missing case");
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
          const stillWorking = PROCESSING.includes(row.status);
          if (stillWorking) {
            setSteps(buildPipeline(row));
            pollUntilDone();
          } else {
            finishReady(row);
          }
        } catch (err) {
          if (!alive) return;
          setError(err.message || "Polling failed");
        }
      }, POLL_MS);
    }

    function persistComplete(row, nextSteps) {
      const conf = extractionConfidence(row);
      saveUploadSession({
        caseId,
        fileName: row.file_name || "",
        steps: nextSteps,
        confidence: conf,
        phase: "complete",
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remount on caseId
  }, [caseId]);

  // Highlight the live stage only — never auto-open the detail sheet.
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
      : "ClearDesk process room";

  function goReview() {
    if (!caseId) return;
    navigate(`/review/${caseId}`, { state: { fromProcess: true } });
  }

  function reviewLater() {
    clearUploadSession();
    showToast?.("Saved for later — find it on Desk");
    navigate("/desk?filter=review");
  }

  function goHome() {
    navigate("/");
  }

  function openStageDetails(step) {
    if (!step?.key) return;
    setSelectedKey(step.key);
    setDetailKey(step.key);
  }

  return (
    <div className="page-enter process-page">
      <header className="process-page__chrome">
        <button type="button" className="btn btn-ghost btn-compact" onClick={goHome}>
          ← Home
        </button>
        <div className="process-page__identity">
          <p className="section-label">Process room</p>
          <strong>{fileName || caseRow?.invoice_number || "Invoice"}</strong>
          {caseId ? (
            <span className="muted process-page__case-id">{caseId.slice(0, 8)}…</span>
          ) : null}
        </div>
        <span
          className={`pill ${working ? "pill-working" : complete ? "pill-review" : "pill-working"}`}
        >
          {working ? "Live" : complete ? outcomeLabel(caseRow?.status) || "Ready" : "Loading"}
        </span>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="process-page__layout">
        <div className="process-page__runway">
          {loading && !steps.length ? (
            <div className="empty-note empty-note--rich">
              <strong>Opening process room</strong>
              <span>Loading agent runway…</span>
            </div>
          ) : (
            <ProcessTheater
              steps={steps.length ? steps : stepsAtIndex(0, fileName || "")}
              variant="hero"
              interactive
              detailsViaHint
              onStepSelect={(step) => setSelectedKey(step.key)}
              onStepDetails={openStageDetails}
              title={runwayTitle}
              subtitle={runwaySubtitle}
              selectedKey={selectedStep?.key}
            />
          )}
        </div>
      </div>

      <div className="process-dock" role="region" aria-label="Process actions">
        <button
          type="button"
          className="process-dock__confidence"
          onClick={() => setConfidenceOpen(true)}
          aria-label="Extraction confidence"
        >
          <span className="section-label">Confidence</span>
          {confidence?.hasAny ? (
            <strong>
              {confidence.overall != null ? `${confidence.overall}%` : "—"}
              <span className="muted"> · {confidenceLabel(confidence.source)}</span>
            </strong>
          ) : (
            <strong className="muted">{working ? "Calculating…" : "Not available"}</strong>
          )}
        </button>

        <div className="process-dock__actions btn-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={goReview}
            disabled={!caseId || working}
          >
            Review invoice
          </button>
          <button type="button" className="btn btn-ghost" onClick={reviewLater} disabled={!caseId}>
            Review later
          </button>
          <Link className="btn btn-ghost" to="/desk">
            Desk
          </Link>
        </div>
      </div>

      <StageDetailSheet step={detailStep} onClose={() => setDetailKey(null)} />

      <DetailSheet
        open={confidenceOpen}
        onClose={() => setConfidenceOpen(false)}
        title="Extraction confidence"
        eyebrow="How we scored this"
        glyph="%"
        labelledBy="process-confidence-title"
        actions={
          caseId && !working ? (
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setConfidenceOpen(false);
                  goReview();
                }}
              >
                Review invoice
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setConfidenceOpen(false);
                  reviewLater();
                }}
              >
                Review later
              </button>
            </div>
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
          </>
        ) : (
          <section className="stage-sheet__block">
            <h3>Not available yet</h3>
            <p>
              {working
                ? "Confidence appears when the document reader finishes."
                : "Confidence wasn’t returned for this case. You can still open the invoice and check fields against the PDF."}
            </p>
          </section>
        )}
      </DetailSheet>

      <AnimatePresence>
        {complete && selectedStep?.key === "decide" ? (
          <motion.p
            className="process-page__hint"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            YOUR TURN — open Review when you’re ready to decide
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
