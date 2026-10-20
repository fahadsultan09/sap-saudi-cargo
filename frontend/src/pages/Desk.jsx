import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiJson } from "../lib/api";
import { buildKpis, filterCases, paginate, sortCases } from "../lib/caseBoard";
import { canProcess, getUser } from "../lib/config";
import { CASE_GROUPS, LIST_REFRESH_MS } from "../lib/constants";
import CaseTable from "../components/CaseTable";
import KpiStrip from "../components/KpiStrip";
import { setPendingFile } from "../lib/pendingUpload";

export default function Desk({ userId }) {
  const navigate = useNavigate();
  const [params, setSearchParams] = useSearchParams();
  const user = getUser(userId);
  const filter = params.get("filter") || "";
  const [cases, setCases] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pageIndex, setPageIndex] = useState(0);
  const [drag, setDrag] = useState(false);

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
    setPageIndex(0);
  }, [filter]);

  const kpis = useMemo(() => buildKpis(cases), [cases]);
  const filtered = useMemo(() => sortCases(filterCases(cases, filter)), [cases, filter]);
  const { items: pageItems, page } = useMemo(
    () => paginate(filtered, pageIndex),
    [filtered, pageIndex],
  );

  function setFilter(key) {
    const next = new URLSearchParams(params);
    if (key) next.set("filter", key);
    else next.delete("filter");
    setSearchParams(next, { replace: true });
  }

  function handoffFile(file) {
    if (!file || !canProcess(user)) return;
    setPendingFile(file);
    navigate("/", { state: { fromDesk: true } });
  }

  function onDrop(e) {
    e.preventDefault();
    setDrag(false);
    handoffFile(e.dataTransfer.files?.[0]);
  }

  return (
    <div className="page-enter desk-page">
      <section className="home-strip" aria-label="Case board">
        <div>
          <p className="section-label" style={{ marginBottom: "0.2rem" }}>
            Desk
          </p>
          <strong className="home-strip__title">Case board</strong>
        </div>
        <div className="home-strip__actions">
          {canProcess(user) ? (
            <Link className="btn btn-primary btn-compact" to="/">
              Add invoice
            </Link>
          ) : null}
          <Link className="btn btn-ghost btn-compact" to="/">
            Home
          </Link>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      {!loading ? <KpiStrip items={kpis} activeKey={filter || "total"} onSelect={setFilter} /> : null}

      <div className="desk-filters" role="tablist" aria-label="Filter cases">
        <button
          type="button"
          role="tab"
          aria-selected={!filter}
          className={`history-filter${!filter ? " history-filter--active" : ""}`}
          onClick={() => setFilter("")}
        >
          All
          <span className="history-filter__count">{cases.length}</span>
        </button>
        {CASE_GROUPS.map((g) => {
          const count = kpis.find((k) => k.key === g.key)?.value ?? 0;
          return (
            <button
              key={g.key}
              type="button"
              role="tab"
              aria-selected={filter === g.key}
              className={`history-filter${filter === g.key ? " history-filter--active" : ""}`}
              onClick={() => setFilter(g.key)}
            >
              {g.label}
              <span className="history-filter__count">{count}</span>
            </button>
          );
        })}
      </div>

      {canProcess(user) ? (
        <label
          className={`desk-dropzone${drag ? " drag" : ""}`}
          onDragEnter={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
        >
          <span>
            Drop a PDF here — or <Link to="/">add on Home</Link>
          </span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => handoffFile(e.target.files?.[0])}
          />
        </label>
      ) : null}

      {loading && !cases.length ? (
        <div className="empty-note empty-note--rich">
          <strong>Loading board</strong>
          <span>Fetching the latest invoices…</span>
        </div>
      ) : (
        <>
          <CaseTable
            cases={pageItems}
            onSelect={(item) => navigate(`/review/${item.id}`)}
            emptyTitle="No invoices in this filter"
            emptyHint="Clear the filter or upload a new invoice."
          />
          {filtered.length > 0 ? (
            <div className="pager">
              <span className="muted">{page.range}</span>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  disabled={page.index <= 0}
                  onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                >
                  Previous
                </button>
                <span className="pager__text">{page.text}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  disabled={page.index >= page.count - 1}
                  onClick={() => setPageIndex((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
