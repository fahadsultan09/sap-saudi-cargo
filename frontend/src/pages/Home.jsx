import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { apiJson } from "../lib/api";
import { canProcess, getUser } from "../lib/config";
import {
  HOME_COACH,
  LIST_REFRESH_MS,
  NEEDS_ATTENTION,
  OUTCOME_TONE,
  PROCESS_STEPS,
  PROCESSING,
} from "../lib/constants";
import { buildPipeline, formatAmount, formatDate, outcomeLabel } from "../lib/pipeline";
import ProcessTheater from "../components/ProcessTheater";
import StageDetailSheet from "../components/StageDetailSheet";

const COACH_KEY = "cleardesk-home-coach-seen";

export default function Home({ userId }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = getUser(userId);
  const [cases, setCases] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedStep, setSelectedStep] = useState(null);
  const [coachOpen, setCoachOpen] = useState(false);

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

  function dismissCoach() {
    setCoachOpen(false);
    try {
      sessionStorage.setItem(COACH_KEY, "1");
    } catch {
      /* ignore */
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

  const recent = useMemo(() => {
    const focus = params.get("focus");
    let list = [...cases];
    if (focus === "review") {
      list = list.filter((c) => NEEDS_ATTENTION.includes(c.status));
    }
    return list
      .sort((a, b) =>
        String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)),
      )
      .slice(0, 8);
  }, [cases, params]);

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
          <div className="attention attention--compact">
            <strong>{attention.length}</strong>
            need{attention.length === 1 ? "s" : ""} attention
            {working.length ? ` · ${working.length} working` : ""}
          </div>
        ) : working.length > 0 ? (
          <div className="attention attention--working attention--compact">
            <strong>{working.length}</strong> working
          </div>
        ) : (
          <div className="attention attention--ok attention--compact">Desk clear</div>
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

      <p className="section-label">
        {params.get("focus") === "review" ? "Needs review" : "Recent results"}
      </p>
      {loading && !cases.length ? (
        <div className="empty-note empty-note--rich">
          <strong>Loading desk</strong>
          <span>Fetching the latest invoices…</span>
        </div>
      ) : recent.length === 0 ? (
        <div className="empty-note empty-note--rich">
          <strong>Nothing here yet</strong>
          <span>Upload an invoice to put ClearDesk to work.</span>
          {canProcess(user) ? (
            <Link className="btn btn-primary" to="/upload" style={{ marginTop: "0.85rem" }}>
              Upload invoice
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="outcome-list">
          {recent.map((item, index) => {
            const outcome = outcomeLabel(item.status);
            const tone = OUTCOME_TONE[outcome] || "review";
            const itemTitle = item.invoice_number || item.file_name || "Invoice";
            const itemSupplier = item.supplier_name || "Supplier pending";
            return (
              <motion.button
                key={item.id}
                type="button"
                className="outcome"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.045, duration: 0.4 }}
                onClick={() => navigate(`/review/${item.id}`)}
              >
                <div>
                  <h3>{itemTitle}</h3>
                  <p>
                    {itemSupplier} · {formatAmount(item)} ·{" "}
                    {formatDate(item.updated_at || item.created_at)}
                  </p>
                </div>
                <span className={`pill pill-${tone}`}>{outcome}</span>
              </motion.button>
            );
          })}
        </div>
      )}

      <StageDetailSheet
        step={selectedStep}
        onClose={() => setSelectedStep(null)}
        actions={stageActions(selectedStep)}
      />
    </div>
  );
}
