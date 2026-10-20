import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { apiJson } from "../lib/api";
import { canProcess, getUser } from "../lib/config";
import {
  HOME_COACH,
  LIST_REFRESH_MS,
  NEEDS_ATTENTION,
  PROCESS_STEPS,
  PROCESSING,
} from "../lib/constants";
import { buildPipeline } from "../lib/pipeline";
import ProcessTheater from "../components/ProcessTheater";
import StageDetailSheet from "../components/StageDetailSheet";
import InvoiceHistorySheet from "../components/InvoiceHistorySheet";

const COACH_KEY = "cleardesk-home-coach-seen";

export default function Home({ userId }) {
  const navigate = useNavigate();
  const [params, setSearchParams] = useSearchParams();
  const user = getUser(userId);
  const [cases, setCases] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedStep, setSelectedStep] = useState(null);
  const [coachOpen, setCoachOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("all");

  useEffect(() => {
    let alive = true;
    let timer;

    async function load() {
      try {
        const data = await apiJson("GET", "/api/v1/cases?limit=200");
        if (!alive) return;
        setCases(data.items || []);
        setError("");
      } catch (err) {
        if (!alive) return;
        setError(err.message);
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

  const liveSteps = useMemo(() => {
    if (!working.length) return null;
    return buildPipeline(working[0]);
  }, [working]);

  const idlePreview = useMemo(
    () =>
      PROCESS_STEPS.map((s) => ({
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
      })),
    [],
  );

  const runwaySteps = liveSteps || idlePreview;

  function stageActions(step) {
    if (!step) return null;
    if (step.key === "receive" && canProcess(user) && !liveSteps) {
      return (
        <Link className="btn btn-primary btn-compact" to="/upload" onClick={() => setSelectedStep(null)}>
          Upload invoice
        </Link>
      );
    }
    if (step.key === "decide" && attention[0]) {
      return (
        <button
          type="button"
          className="btn btn-primary btn-compact"
          onClick={() => {
            setSelectedStep(null);
            navigate(`/review/${attention[0].id}`);
          }}
        >
          Open next to review
        </button>
      );
    }
    return null;
  }

  return (
    <div className="page-enter">
      <section className="home-strip" aria-label="Quick actions">
        {attention.length > 0 ? (
          <button
            type="button"
            className="attention attention--compact attention--clickable"
            onClick={() => openHistory("review")}
            aria-label={`${attention.length} need attention — open invoice list`}
          >
            <strong>{attention.length}</strong>
            need{attention.length === 1 ? "s" : ""} attention
            {working.length ? ` · ${working.length} working` : ""}
          </button>
        ) : working.length > 0 ? (
          <button
            type="button"
            className="attention attention--working attention--compact attention--clickable"
            onClick={() => openHistory("working")}
            aria-label={`${working.length} working — open invoice list`}
          >
            <strong>{working.length}</strong> working
          </button>
        ) : (
          <button
            type="button"
            className="attention attention--ok attention--compact attention--clickable"
            onClick={() => openHistory("all")}
            aria-label="Desk clear — open invoice history"
          >
            Desk clear
          </button>
        )}

        <div className="home-strip__actions">
          {canProcess(user) && (
            <Link className="btn btn-primary btn-compact" to="/upload">
              Upload
            </Link>
          )}
          {attention[0] && (
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={() => navigate(`/review/${attention[0].id}`)}
            >
              Open next
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={() => openHistory("all")}
            aria-expanded={historyOpen}
          >
            Invoices
            {cases.length ? (
              <span className="home-strip__count">{cases.length}</span>
            ) : null}
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

      {error ? <div className="error-banner">{error}</div> : null}

      {!loading && (
        <section className="home-runway">
          <ProcessTheater
            steps={runwaySteps}
            variant="hero"
            interactive
            onStepSelect={setSelectedStep}
            title={liveSteps ? "Agents working" : "Agent runway"}
            subtitle={
              liveSteps
                ? `${working[0]?.file_name || working[0]?.invoice_number || "Invoice"} — live`
                : "Classifier → Document reader → Finance check → Your review"
            }
          />
        </section>
      )}

      {loading && !cases.length ? (
        <div className="empty-note empty-note--rich">
          <strong>Loading desk</strong>
          <span>Fetching the latest invoices…</span>
        </div>
      ) : !loading && cases.length === 0 ? (
        <div className="empty-note empty-note--rich home-empty">
          <strong>Nothing here yet</strong>
          <span>Upload an invoice to put ClearDesk to work.</span>
          {canProcess(user) ? (
            <Link className="btn btn-primary" to="/upload" style={{ marginTop: "0.85rem" }}>
              Upload invoice
            </Link>
          ) : null}
        </div>
      ) : null}

      <StageDetailSheet
        step={selectedStep}
        onClose={() => setSelectedStep(null)}
        actions={stageActions(selectedStep)}
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
