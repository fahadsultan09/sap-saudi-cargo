import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiJson, casePath } from "../lib/api";
import { extractionConfidence } from "../lib/confidence";
import { POLL_MS, PROCESS_STEPS, PROCESSING, UPLOAD_WATCH_MIN_MS } from "../lib/constants";
import { playAgentRunway, stepsAtIndex } from "../lib/agentRunway";
import { buildPipeline } from "../lib/pipeline";
import { clearUploadSession, loadUploadSession, saveUploadSession } from "../lib/uploadSession";
import { takePendingFile } from "../lib/pendingUpload";

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

/**
 * Shared invoice upload + agent runway state for Home (and Desk handoff).
 */
export function useInvoiceUpload({ enabled, showToast } = {}) {
  const navigate = useNavigate();
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState(() => (readRestoredSession() ? "complete" : "idle"));
  const [fileName, setFileName] = useState(() => readRestoredSession()?.fileName || "");
  const [caseId, setCaseId] = useState(() => readRestoredSession()?.caseId || "");
  const [caseRow, setCaseRow] = useState(null);
  const [steps, setSteps] = useState(() => {
    const saved = readRestoredSession();
    return saved && Array.isArray(saved.steps) && saved.steps.length ? saved.steps : [];
  });
  const [confidence, setConfidence] = useState(() => readRestoredSession()?.confidence || null);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [duplicate, setDuplicate] = useState(null);
  const pollRef = useRef(null);
  const runwayRef = useRef(null);
  const apiDoneRef = useRef(null);

  useEffect(
    () => () => {
      clearTimeout(pollRef.current);
      runwayRef.current?.cancel();
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    const pending = takePendingFile();
    if (pending) uploadFile(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handoff once when enabled
  }, [enabled]);

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

  async function uploadFile(file) {
    if (!file || !enabled) return;
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

  /** Keep the case on Desk; leave the post-upload runway without opening Review. */
  function reviewLater() {
    startAnother();
    showToast?.("Saved for later — find it on Desk");
    navigate("/desk?filter=review");
  }

  const watching = phase === "watching";
  const complete = phase === "complete";
  const active = watching || complete;

  return {
    drag,
    setDrag,
    phase,
    watching,
    complete,
    active,
    fileName,
    caseId,
    caseRow,
    steps,
    confidence,
    error,
    detail,
    setDetail,
    duplicate,
    setDuplicate,
    uploadFile,
    onDrop,
    startAnother,
    reviewLater,
    goToReview,
    continueAfterDuplicate,
    PROCESS_STEPS_LEN: PROCESS_STEPS.length,
  };
}
