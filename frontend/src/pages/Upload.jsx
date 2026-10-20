import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { apiJson, casePath } from "../lib/api";
import { canProcess, getUser } from "../lib/config";
import { POLL_MS, PROCESS_STEPS, PROCESSING, UPLOAD_WATCH_MIN_MS } from "../lib/constants";
import { buildPipeline } from "../lib/pipeline";
import ProcessTheater from "../components/ProcessTheater";

function seedSteps() {
  return PROCESS_STEPS.map((s, i) => ({
    key: s.key,
    title: s.title,
    description: s.plain,
    nowLabel: i === 0 ? "Receiving your file…" : "",
    state: i === 0 ? "running" : "pending",
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
  const startedAt = useRef(0);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!canProcess(user)) {
      navigate("/");
    }
  }, [user, navigate]);

  useEffect(() => () => clearTimeout(pollRef.current), []);

  async function uploadFile(file) {
    if (!file) return;
    setError("");
    setFileName(file.name);
    setWatching(true);
    setSteps(seedSteps());
    startedAt.current = Date.now();

    const form = new FormData();
    form.append("file", file);

    try {
      const result = await apiJson("POST", "/api/v1/cases/upload", form);
      const id = result.case_id || result.id;
      setCaseId(id);
      showToast?.("Invoice received — agents spinning up");
      pollCase(id);
    } catch (err) {
      setError(err.message);
      setWatching(false);
      setSteps([]);
    }
  }

  function pollCase(id) {
    clearTimeout(pollRef.current);
    pollRef.current = setTimeout(async () => {
      try {
        const row = await apiJson("GET", casePath(id));
        const next = buildPipeline(row);
        setSteps(next);
        const stillWorking = PROCESSING.includes(row.status);
        const elapsed = Date.now() - startedAt.current;

        if (stillWorking) {
          pollCase(id);
          return;
        }

        if (elapsed < UPLOAD_WATCH_MIN_MS) {
          pollRef.current = setTimeout(() => finishAndGo(id), UPLOAD_WATCH_MIN_MS - elapsed);
          return;
        }
        finishAndGo(id);
      } catch (err) {
        setError(err.message);
        setWatching(false);
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
            : "Drop a PDF. Agents will read it, check the numbers, then hand it to you."}
        </p>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <AnimatePresence mode="wait">
        {!watching ? (
          <motion.label
            key="drop"
            className={`dropzone${drag ? " drag" : ""}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.4 }}
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
          </motion.label>
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
              title="Working on your invoice"
              subtitle="Each step lights up as we work through your invoice"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
