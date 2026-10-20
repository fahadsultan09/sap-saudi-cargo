import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { apiJson } from "../lib/api";
import { canProcess, getUser } from "../lib/config";
import {
  LIST_REFRESH_MS,
  NEEDS_ATTENTION,
  OUTCOME_TONE,
  PROCESS_STEPS,
  PROCESSING,
} from "../lib/constants";
import { buildPipeline, formatAmount, formatDate, outcomeLabel } from "../lib/pipeline";
import ProcessTheater from "../components/ProcessTheater";

export default function Home({ userId, showToast }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = getUser(userId);
  const [cases, setCases] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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
      PROCESS_STEPS.map((s, i) => ({
        key: s.key,
        title: s.title,
        description: s.plain,
        nowLabel: "",
        state: "pending",
        agent: s.agent || "",
        codename: s.codename || "",
        role: s.role || "",
        glyph: s.glyph || "●",
      })),
    [],
  );

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

  return (
    <div className="page-enter">
      <section className="hero">
        <img className="hero-brand" src="/logo.png" alt="Saudi Cargo" />
        <h1>Your invoice desk</h1>
        <p>
          Upload an invoice, watch agents read and check it live, then approve when it is ready.
        </p>
        {attention.length > 0 ? (
          <div className="attention">
            <strong>{attention.length}</strong>
            need{attention.length === 1 ? "s" : ""} your attention
            {working.length ? ` · ${working.length} working` : ""}
          </div>
        ) : working.length > 0 ? (
          <div className="attention attention--working">
            <strong>{working.length}</strong> working right now
          </div>
        ) : (
          <div className="attention attention--ok">Desk is clear</div>
        )}
        <div className="btn-row">
          {canProcess(user) && (
            <Link className="btn btn-primary" to="/upload">
              Upload invoice
            </Link>
          )}
          {attention[0] && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => navigate(`/review/${attention[0].id}`)}
            >
              Open next to review
            </button>
          )}
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      {!loading && (
        <section className="home-live">
          <p className="section-label">
            {liveSteps ? "Live on the runway" : "How invoices move"}
          </p>
          <ProcessTheater
            steps={liveSteps || idlePreview}
            variant="mini"
            title={liveSteps ? "Working now" : "How invoices move"}
            subtitle={
              liveSteps
                ? working[0]?.file_name || working[0]?.invoice_number || "Invoice in flight"
                : "Reading invoice → Pulling out details → Checking numbers → Ready for you"
            }
          />
        </section>
      )}

      <p className="section-label">Recent results</p>
      {loading && !cases.length ? (
        <div className="empty-note">Loading…</div>
      ) : recent.length === 0 ? (
        <div className="empty-note">Nothing here yet. Upload an invoice to start the demo.</div>
      ) : (
        <div className="outcome-list">
          {recent.map((item, index) => {
            const outcome = outcomeLabel(item.status);
            const tone = OUTCOME_TONE[outcome] || "review";
            const title = item.invoice_number || item.file_name || "Invoice";
            const supplier = item.supplier_name || "Supplier pending";
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
                  <h3>{title}</h3>
                  <p>
                    {supplier} · {formatAmount(item)} ·{" "}
                    {formatDate(item.updated_at || item.created_at)}
                  </p>
                </div>
                <span className={`pill pill-${tone}`}>{outcome}</span>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}
