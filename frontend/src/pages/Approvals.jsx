import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { apiJson, casePath } from "../lib/api";
import { nextDecidable, sortCases } from "../lib/caseBoard";
import { canApprove, getUser } from "../lib/config";
import { DECIDABLE, LIST_REFRESH_MS } from "../lib/constants";
import { formatAmount, outcomeLabel } from "../lib/pipeline";
import CaseTable from "../components/CaseTable";
import DecisionModal from "../components/DecisionModal";

export default function Approvals({ userId, showToast }) {
  const navigate = useNavigate();
  const user = getUser(userId);
  const [cases, setCases] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await apiJson("GET", "/api/v1/cases?limit=200");
      setCases(data.items || []);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canApprove(user)) return undefined;
    let alive = true;
    load();
    const timer = setInterval(() => {
      if (alive) load();
    }, LIST_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [userId, user, load]);

  const queue = useMemo(
    () => sortCases(cases.filter((c) => DECIDABLE.includes(c.status))),
    [cases],
  );

  if (!canApprove(user)) {
    return <Navigate to="/desk" replace />;
  }

  function openDecide(item, action) {
    if (action === "approve") {
      setModal({
        item,
        kind: action,
        title: "Approve invoice",
        label: "Comment (optional)",
        placeholder: "Add a note for the audit trail",
        submitText: "Approve",
        minLength: 0,
      });
    } else if (action === "return") {
      setModal({
        item,
        kind: action,
        title: "Send back",
        label: "What should be fixed?",
        placeholder: "Reason for sending this back",
        submitText: "Send back",
        minLength: 3,
      });
    } else {
      setModal({
        item,
        kind: action,
        title: "Reject invoice",
        label: "Why is this rejected?",
        placeholder: "Reason for this decision",
        submitText: "Reject",
        minLength: 3,
      });
    }
  }

  async function onModalSubmit(text) {
    const current = modal;
    setModal(null);
    if (!current?.item?.id) return;
    setBusyId(current.item.id);
    try {
      await apiJson("POST", `${casePath(current.item.id)}/${current.kind}`, {
        comment: text,
      });
      const labels = { approve: "Approved", return: "Sent back", reject: "Rejected" };
      showToast?.(labels[current.kind] || "Done");
      await load();
      const next = nextDecidable(cases, current.item.id, DECIDABLE);
      if (next) {
        showToast?.(`Next in queue: ${next.invoice_number || next.file_name || "invoice"}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="page-enter">
      <section className="home-strip" aria-label="Approvals">
        <div>
          <p className="section-label" style={{ marginBottom: "0.2rem" }}>
            Approvals
          </p>
          <strong className="home-strip__title">
            {queue.length ? `${queue.length} need a decision` : "Queue clear"}
          </strong>
        </div>
        <div className="home-strip__actions">
          <Link className="btn btn-ghost btn-compact" to="/desk?filter=awaiting">
            Board
          </Link>
          {queue[0] ? (
            <button
              type="button"
              className="btn btn-primary btn-compact"
              onClick={() => navigate(`/review/${queue[0].id}`)}
            >
              Open first
            </button>
          ) : null}
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      {loading && !cases.length ? (
        <div className="empty-note empty-note--rich">
          <strong>Loading queue</strong>
          <span>Fetching invoices that need a decision…</span>
        </div>
      ) : (
        <CaseTable
          cases={queue}
          onSelect={(item) => navigate(`/review/${item.id}`)}
          emptyTitle="Nothing waiting"
          emptyHint="When processors finish staging invoices, they land here for Approve, Send back, or Reject."
          actionsForRow={(item) => (
            <div className="inline-actions">
              <button
                type="button"
                className="btn btn-warn btn-compact"
                disabled={busyId === item.id}
                onClick={(e) => {
                  e.stopPropagation();
                  openDecide(item, "return");
                }}
              >
                Send back
              </button>
              <button
                type="button"
                className="btn btn-danger btn-compact"
                disabled={busyId === item.id}
                onClick={(e) => {
                  e.stopPropagation();
                  openDecide(item, "reject");
                }}
              >
                Reject
              </button>
              <button
                type="button"
                className="btn btn-primary btn-compact"
                disabled={busyId === item.id}
                onClick={(e) => {
                  e.stopPropagation();
                  openDecide(item, "approve");
                }}
              >
                Approve
              </button>
            </div>
          )}
        />
      )}

      {queue.length > 0 ? (
        <p className="muted desk-footnote">
          Tip: open a row for the PDF and full comparison, or decide inline. Amounts shown:{" "}
          {queue
            .slice(0, 3)
            .map((c) => `${c.invoice_number || "Invoice"} ${formatAmount(c)} (${outcomeLabel(c.status)})`)
            .join(" · ")}
          {queue.length > 3 ? "…" : ""}
        </p>
      ) : null}

      {modal ? (
        <DecisionModal
          title={modal.title}
          label={modal.label}
          placeholder={modal.placeholder}
          submitText={modal.submitText}
          minLength={modal.minLength}
          onCancel={() => setModal(null)}
          onSubmit={onModalSubmit}
        />
      ) : null}
    </div>
  );
}
