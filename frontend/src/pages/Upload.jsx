import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { apiJson, casePath } from "../lib/api";
import { canProcess, getUser } from "../lib/config";
import { POLL_MS, PROCESS_STEPS, PROCESSING, UPLOAD_WATCH_MIN_MS } from "../lib/constants";
import { playDemoRunway, stepsAtIndex } from "../lib/demoRunway";
import { buildPipeline } from "../lib/pipeline";
import ProcessTheater from "../components/ProcessTheater";

function idleSteps() {
  return PROCESS_STEPS.map((s) => ({
    key: s.key,
    title: s.title,
    description: s.plain,
    nowLabel: "",
    state: "pending",
    agent: s.agent || "",
    codename: s.codename || "",
    role: s.role || "",
    glyph: s.glyph || "●",
  }));
}

export default function Upload({ userId, showToast }) {
  const navigate = useNavigate();
  const user = getUser(userId);
  const [drag, setDrag] = useState(false);
  const [watching, setWatching] = useState(false);
  const [fileName, setFileName] = useState("");
  const [caseId, setCaseId] = useState("");
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState("");
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

  async function uploadFile(file) {
    if (!file) return;
    setError("");
    setFileName(file.name);
    setWatching(true);
    setSteps(stepsAtIndex(0, file.name));
    apiDoneRef.current = null;

    // Always play the agent runway for demo wow (API may finish instantly)
    runwayRef.current?.cancel();
    const runway = playDemoRunway({
      fileName: file.name,
      minMs: UPLOAD_WATCH_MIN_MS,
      onFrame: (next) => {
        // Prefer live API pipeline while still processing
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
      // Wait until API has a terminal status (or already done)
      const finalId = await waitForCase(id);
      finishAndGo(finalId || id);
    } catch (err) {
      runway.cancel();
      setError(err.message);
      setWatching(false);
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
          // Let the demo runway finish painting; keep last API pipeline if richer
          const piped = buildPipeline(row);
          if (piped.some((s) => s.state === "done")) {
            // merge gently — runway onFrame may still run
            setSteps((prev) => {
              const runwayAhead = prev.filter((s) => s.state === "running" || s.state === "done").length;
              return runwayAhead >= 3 ? prev : piped;
            });
          }
        }
      } catch (err) {
        setError(err.message);
        setWatching(false);
        runwayRef.current?.cancel();
      }
    }, POLL_MS);
  }

  function finishAndGo(id) {
    clearTimeout(pollRef.current);
    setWatching(false);
    showToast?.("Ready for you — opening review");
    navigate(`/review/${id}`);
  }

  function onDrop(e) {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  return (
    <div className="page-enter">
      <section className="hero" style={{ marginBottom: "1.25rem" }}>
        <h1>{watching ? "Command runway" : "Upload invoice"}</h1>
        <p>
          {watching
            ? "Stay here — agents classify, read, and check your invoice in real time."
            : "Drop a PDF. ClearDesk agents will read it, check the numbers, then hand it to you."}
        </p>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <AnimatePresence mode="wait">
        {!watching ? (
          <motion.div
            key="drop"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.4 }}
          >
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
            <div style={{ marginTop: "1.35rem" }}>
              <ProcessTheater
                steps={preview}
                variant="compact"
                title="Agents standing by"
                subtitle="They light up the moment your file lands"
              />
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="theater"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45 }}
          >
            <div className="upload-watch-meta">
              <span className="pill pill-working">Live</span>
              <span className="muted">
                Processing <strong>{fileName}</strong>
                {caseId ? ` · ${caseId.slice(0, 8)}…` : ""}
              </span>
            </div>
            <ProcessTheater
              steps={steps}
              title="Agents on the runway"
              subtitle="Each node lights as work advances — connectors fill between stages"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
