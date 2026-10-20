import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { apiJson } from "../lib/api";
import { canProcess, getUser } from "../lib/config";
import { confidenceLabel } from "../lib/confidence";
import {
  HOME_COACH,
  LIST_REFRESH_MS,
  NEEDS_ATTENTION,
  PROCESS_STEPS,
  PROCESSING,
} from "../lib/constants";
import { buildPipeline, formatDateTime, outcomeLabel } from "../lib/pipeline";
import { useInvoiceUpload } from "../hooks/useInvoiceUpload";
import ProcessTheater from "../components/ProcessTheater";
import StageDetailSheet from "../components/StageDetailSheet";
import InvoiceHistorySheet from "../components/InvoiceHistorySheet";
import DetailSheet from "../components/DetailSheet";
import DuplicateDialog from "../components/DuplicateDialog";

const COACH_KEY = "cleardesk-home-coach-seen";

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

export default function Home({ userId, showToast }) {
  const navigate = useNavigate();
  const [params, setSearchParams] = useSearchParams();
  const user = getUser(userId);
  const processor = canProcess(user);
  const [cases, setCases] = useState([]);
  const [listError, setListError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedStep, setSelectedStep] = useState(null);
  const [coachOpen, setCoachOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("all");
  const preview = useMemo(() => idleSteps(), []);

  const upload = useInvoiceUpload({ enabled: processor, showToast });

  useEffect(() => {
    let alive = true;
    let timer;

    async function load() {
      try {
        const data = await apiJson("GET", "/api/v1/cases?limit=200");
        if (!alive) return;
        setCases(data.items || []);
        setListError("");
      } catch (err) {
        if (!alive) return;
        setListError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    timer = setInterval(load, LIST_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [userId]);

  useEffect(() => {
    try {
      if (!sessionStorage.getItem(COACH_KEY)) {
        setCoachOpen(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const focus = params.get("focus");
    if (focus === "review") {
      setHistoryFilter("review");
      setHistoryOpen(true);
    } else if (focus === "history" || focus === "invoices") {
      setHistoryFilter("all");
      setHistoryOpen(true);
    }
  }, [params]);

  function dismissCoach() {
    setCoachOpen(false);
    try {
      sessionStorage.setItem(COACH_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function openHistory(filter = "all") {
    setHistoryFilter(filter);
    setHistoryOpen(true);
  }

  function openBoard(filterKey) {
    navigate(filterKey ? `/desk?filter=${filterKey}` : "/desk");
  }

  function closeHistory() {
    setHistoryOpen(false);
    if (params.get("focus")) {
      const next = new URLSearchParams(params);
      next.delete("focus");
      setSearchParams(next, { replace: true });
    }
  }

  const attention = useMemo(
    () => cases.filter((c) => NEEDS_ATTENTION.includes(c.status)),
    [cases],
  );
  const working = useMemo(
    () => cases.filter((c) => PROCESSING.includes(c.status)),
    [cases],
  );

  const boardLiveSteps = useMemo(() => {
    if (!working.length || upload.active) return null;
    return buildPipeline(working[0]);
  }, [working, upload.active]);

  const runwaySteps = upload.active
    ? upload.steps
    : boardLiveSteps || preview;

  const runwayTitle = upload.watching
    ? "Agents working"
    : upload.complete
      ? "Ready for review"
      : boardLiveSteps
        ? "Agents working"
        : "Agent runway";

  const runwaySubtitle = upload.watching
    ? "Tap a stage for details — live while agents read this invoice"
    : upload.complete
      ? "Agents finished — open the invoice or add another"
      : boardLiveSteps
        ? `${working[0]?.file_name || working[0]?.invoice_number || "Invoice"} — live`
        : "Drop a PDF below — Classifier → Reader → Finance → Your review";

  function onStepSelect(step) {
    if (upload.complete && step?.key === "decide") {
      upload.goToReview();
      return;
    }
    setSelectedStep(step);
  }

  function scrollToDrop() {
    document.getElementById("home-dropzone")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function stageActions(step) {
    if (!step) return null;
    if (step.key === "receive" && processor && !upload.active && !boardLiveSteps) {
      return (
        <button type="button" className="btn btn-primary btn-compact" onClick={() => {
          setSelectedStep(null);
          scrollToDrop();
        }}>
          Add invoice
        </button>
      );
    }
    if (upload.complete && step.key === "decide") {
      return (
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary btn-compact"
            onClick={() => {
              setSelectedStep(null);
              upload.goToReview();
            }}
          >
            Review invoice
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={() => {
              setSelectedStep(null);
              upload.reviewLater();
            }}
          >
            Review later
          </button>
        </div>
      );
    }
    if (step.key === "decide" && attention[0] && !upload.active) {
      return (
        <button
          type="button"
          className="btn btn-primary btn-compact"
          onClick={() => {
            setSelectedStep(null);
            navigate(`/review/${attention[0].id}`);
          }}
        >
          Open attention queue
        </button>
      );
    }
    return null;
  }

  const bannerError = upload.error || listError;

  return (
    <div className="page-enter">
      <section className="home-strip" aria-label="Quick actions">
        {attention.length > 0 ? (
          <button
            type="button"
            className="attention attention--compact attention--clickable"
            onClick={() => openBoard("review")}
            aria-label={`${attention.length} need attention — open case board`}
          >
            <strong>{attention.length}</strong>
            need{attention.length === 1 ? "s" : ""} attention
            {working.length ? ` · ${working.length} working` : ""}
          </button>
        ) : working.length > 0 ? (
          <button
            type="button"
            className="attention attention--working attention--compact attention--clickable"
            onClick={() => openBoard("processing")}
            aria-label={`${working.length} working — open case board`}
          >
            <strong>{working.length}</strong> working
          </button>
        ) : (
          <button
            type="button"
            className="attention attention--ok attention--compact attention--clickable"
            onClick={() => openBoard("")}
            aria-label="Desk clear — open case board"
          >
            Desk clear
          </button>
        )}

        <div className="home-strip__actions">
          {processor ? (
            <button
              type="button"
              className="btn btn-primary btn-compact"
              onClick={upload.active ? upload.startAnother : scrollToDrop}
            >
              {upload.active ? "Add another" : "Add invoice"}
            </button>
          ) : null}
          <Link className="btn btn-ghost btn-compact" to="/desk">
            Board
            {cases.length ? (
              <span className="home-strip__count">{cases.length}</span>
            ) : null}
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={() => openHistory("all")}
            aria-expanded={historyOpen}
          >
            Invoices
          </button>
          <button
            type="button"
            className={`home-info${coachOpen ? " home-info--open" : ""}`}
            aria-label="How this desk works"
            aria-expanded={coachOpen}
            onClick={() => (coachOpen ? dismissCoach() : setCoachOpen(true))}
          >
            ⓘ
          </button>
        </div>
      </section>

      <AnimatePresence>
        {coachOpen ? (
          <motion.aside
            className="home-coach"
            role="note"
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -6, height: 0 }}
            transition={{ duration: 0.28 }}
          >
            <div className="home-coach__inner">
              <div>
                <strong>{HOME_COACH.title}</strong>
                <p>{HOME_COACH.body}</p>
              </div>
              <button type="button" className="btn btn-ghost btn-compact" onClick={dismissCoach}>
                Got it
              </button>
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>

      {bannerError ? <div className="error-banner">{bannerError}</div> : null}

      {upload.active ? (
        <div className="upload-watch-meta upload-watch-meta--home">
          <button
            type="button"
            className={`pill pill-clickable ${upload.complete ? "pill-review" : "pill-working"}`}
            onClick={() => upload.setDetail("status")}
            aria-label="Open status details"
          >
            {upload.complete ? "Done" : "Live"}
          </button>
          <button
            type="button"
            className="meta-chip"
            onClick={() => upload.setDetail("case")}
            aria-label="Open case details"
          >
            <strong>{upload.fileName || "Invoice"}</strong>
            {upload.caseId ? ` · ${upload.caseId.slice(0, 8)}…` : ""}
          </button>
        </div>
      ) : null}

      {!loading && (
        <section className="home-runway">
          <ProcessTheater
            steps={runwaySteps}
            variant="hero"
            interactive
            onStepSelect={onStepSelect}
            title={runwayTitle}
            subtitle={runwaySubtitle}
          />

          {upload.complete ? (
            <motion.div
              className="upload-result"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12, duration: 0.35 }}
            >
              <button
                type="button"
                className="upload-result__confidence upload-result__confidence--clickable"
                aria-label="How confidence was derived"
                onClick={() => upload.setDetail("confidence")}
              >
                <p className="section-label">Extraction confidence</p>
                {upload.confidence?.hasAny ? (
                  <div className="upload-result__score-row">
                    <strong className="upload-result__score">
                      {upload.confidence.overall != null ? `${upload.confidence.overall}%` : "—"}
                    </strong>
                    <span className="muted">
                      {confidenceLabel(upload.confidence.source)} · tap for how
                    </span>
                  </div>
                ) : (
                  <p className="muted">Confidence wasn’t returned — tap for details</p>
                )}
              </button>

              <div className="upload-result__actions btn-row">
                <button type="button" className="btn btn-primary" onClick={() => upload.goToReview()}>
                  Review invoice
                </button>
                <button type="button" className="btn btn-ghost" onClick={upload.reviewLater}>
                  Review later
                </button>
                <button type="button" className="btn btn-ghost" onClick={upload.startAnother}>
                  Add another
                </button>
              </div>
            </motion.div>
          ) : null}
        </section>
      )}

      {processor && !upload.active ? (
        <label
          id="home-dropzone"
          className={`dropzone dropzone--home${upload.drag ? " drag" : ""}`}
          onDragEnter={(e) => {
            e.preventDefault();
            upload.setDrag(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => upload.setDrag(false)}
          onDrop={upload.onDrop}
        >
          <div>
            <h2>Drop PDF to add an invoice</h2>
            <p>or click to choose a file — agents start on Home</p>
          </div>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => upload.uploadFile(e.target.files?.[0])}
          />
        </label>
      ) : null}

      {loading && !cases.length ? (
        <div className="empty-note empty-note--rich">
          <strong>Loading desk</strong>
          <span>Fetching the latest invoices…</span>
        </div>
      ) : !loading && cases.length === 0 && !upload.active && !processor ? (
        <div className="empty-note empty-note--rich home-empty">
          <strong>Nothing here yet</strong>
          <span>Switch to Processor to add an invoice, or open the board.</span>
        </div>
      ) : null}

      <StageDetailSheet
        step={selectedStep}
        onClose={() => setSelectedStep(null)}
        actions={stageActions(selectedStep)}
      />

      <DetailSheet
        open={upload.detail === "confidence"}
        onClose={() => upload.setDetail(null)}
        title="Extraction confidence"
        eyebrow="How we scored this"
        glyph="%"
        labelledBy="confidence-sheet-title"
        actions={
          upload.caseId ? (
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  upload.setDetail(null);
                  upload.goToReview();
                }}
              >
                Review invoice
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  upload.setDetail(null);
                  upload.reviewLater();
                }}
              >
                Review later
              </button>
            </div>
          ) : null
        }
      >
        {upload.confidence?.hasAny ? (
          <>
            <div className="stage-sheet__status">
              <span className="agent-status agent-status--done">
                {upload.confidence.overall != null ? `${upload.confidence.overall}%` : "—"}
              </span>
              <p className="stage-sheet__now">{confidenceLabel(upload.confidence.source)}</p>
            </div>
            <section className="stage-sheet__block">
              <h3>How this score was derived</h3>
              <p>
                {upload.confidence.source === "average"
                  ? "We averaged the confidence of each extracted field when an overall score wasn’t provided."
                  : upload.confidence.source === "classification"
                    ? "This figure is how sure the classifier is that the file is an invoice."
                    : "This is the overall extraction confidence returned after reading the PDF."}
              </p>
            </section>
            {upload.confidence.classification != null ? (
              <section className="stage-sheet__block">
                <h3>Document type</h3>
                <p>{upload.confidence.classification}% sure this is an invoice (or credit note).</p>
              </section>
            ) : null}
            {upload.confidence.fields?.length ? (
              <section className="stage-sheet__block">
                <h3>Per-field confidence</h3>
                <ul className="detail-kv">
                  {upload.confidence.fields.map((f) => (
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
        open={upload.detail === "case" || upload.detail === "status"}
        onClose={() => upload.setDetail(null)}
        title={upload.detail === "status" ? "Status" : "Case"}
        eyebrow={upload.fileName || "Invoice"}
        glyph={upload.detail === "status" ? "●" : "#"}
        labelledBy="home-case-sheet-title"
        actions={
          upload.complete && upload.caseId ? (
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  upload.setDetail(null);
                  upload.goToReview();
                }}
              >
                Review invoice
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  upload.setDetail(null);
                  upload.reviewLater();
                }}
              >
                Review later
              </button>
            </div>
          ) : null
        }
      >
        <section className="stage-sheet__block">
          <h3>Case id</h3>
          <p>
            <code className="detail-code">{upload.caseId || "—"}</code>
          </p>
        </section>
        <section className="stage-sheet__block">
          <h3>Status</h3>
          <p>
            {upload.complete
              ? outcomeLabel(upload.caseRow?.status) || "Ready for review"
              : "Agents are still reading this invoice"}
          </p>
        </section>
        <section className="stage-sheet__block">
          <h3>File</h3>
          <p>{upload.fileName || upload.caseRow?.file_name || "—"}</p>
        </section>
        {upload.caseRow?.created_at || upload.caseRow?.updated_at ? (
          <section className="stage-sheet__block">
            <h3>Timestamps</h3>
            <ul className="detail-kv">
              {upload.caseRow.created_at ? (
                <li>
                  <span>Created</span>
                  <strong>{formatDateTime(upload.caseRow.created_at)}</strong>
                </li>
              ) : null}
              {upload.caseRow.updated_at ? (
                <li>
                  <span>Updated</span>
                  <strong>{formatDateTime(upload.caseRow.updated_at)}</strong>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}
      </DetailSheet>

      <DuplicateDialog
        open={Boolean(upload.duplicate)}
        mode={upload.duplicate?.mode}
        fileName={upload.duplicate?.fileName}
        caseId={upload.duplicate?.caseId}
        status={upload.duplicate?.status}
        onOpenExisting={() => {
          const id = upload.duplicate?.caseId;
          upload.setDuplicate(null);
          if (id) upload.goToReview(id);
        }}
        onContinue={upload.continueAfterDuplicate}
        onDismiss={() => upload.setDuplicate(null)}
      />

      <InvoiceHistorySheet
        open={historyOpen}
        cases={cases}
        initialFilter={historyFilter}
        onClose={closeHistory}
        onSelect={(item) => navigate(`/review/${item.id}`)}
      />
    </div>
  );
}
