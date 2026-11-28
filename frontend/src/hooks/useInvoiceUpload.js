import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiJson } from "../lib/api";
import { PROCESS_STEPS, UPLOAD_WATCH_MIN_MS } from "../lib/constants";
import { playAgentRunway, stepsAtIndex } from "../lib/agentRunway";
import { clearUploadSession, loadUploadSession, saveUploadSession } from "../lib/uploadSession";
import { takePendingFile } from "../lib/pendingUpload";

function readRestoredSession() {
  const saved = loadUploadSession();
  if (!saved || saved.phase !== "complete" || !saved.caseId) return null;
  return saved;
}

/**
 * Shared invoice upload + agent runway state for Home (and Desk handoff).
 * After the API accepts the file, live polling moves to /process/:caseId.
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
    if (!saved || !Array.isArray(saved.steps) || !saved.steps.length) return [];
    // Migrate older sessions that left "Your review" in agent "running" state.
    return saved.steps.map((step) =>
      step.key === "decide" && step.state === "running"
        ? {
            ...step,
            state: "awaiting",
            description: step.description || "Handing off to you…",
            nowLabel: step.nowLabel || "Ready for you…",
          }
        : step,
    );
  });
  const [confidence, setConfidence] = useState(() => readRestoredSession()?.confidence || null);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [duplicate, setDuplicate] = useState(null);
  const runwayRef = useRef(null);

  useEffect(
    () => () => {
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

  function goToReview(id = caseId) {
    if (!id) {
      showToast?.("Case id missing — open the invoice from Desk");
      return;
    }
    navigate(`/review/${id}`, { state: { fromUpload: true, caseId: id } });
  }

  function goToProcess(id = caseId) {
    if (!id) return;
    navigate(`/cases/${id}`, { state: { fromUpload: true, fileName } });
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
    clearUploadSession();

    runwayRef.current?.cancel();
    const runway = playAgentRunway({
      fileName: file.name,
      minMs: UPLOAD_WATCH_MIN_MS,
      onFrame: (next) => setSteps(next),
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

      if (!id) {
        runway.cancel();
        setError("Upload succeeded but no case id was returned");
        setPhase("idle");
        setSteps([]);
        return;
      }

      setCaseId(id);
      saveUploadSession({
        caseId: id,
        fileName: file.name,
        steps: stepsAtIndex(0, file.name),
        confidence: null,
        phase: "watching",
      });
      showToast?.("Invoice received — opening review");
      runway.cancel();
      navigate(`/cases/${id}`, { state: { fromUpload: true, fileName: file.name } });
      setPhase("idle");
      setSteps([]);
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
    goToProcess,
    continueAfterDuplicate,
    PROCESS_STEPS_LEN: PROCESS_STEPS.length,
  };
}
