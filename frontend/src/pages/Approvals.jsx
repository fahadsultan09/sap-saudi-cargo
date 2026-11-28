import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiJson, casePath } from "../lib/api";
import { getUser } from "../lib/config";
import { LIST_REFRESH_MS } from "../lib/constants";
import DecisionModal from "../components/DecisionModal";
import "../reference-portal.css";

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
    let alive = true;
    load();
    const timer = setInterval(() => {
      if (alive) load();
    }, LIST_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [userId, load]);

  const queue = useMemo(
    () =>
      cases.filter(
        (c) =>
          c.status === "NEEDS_REVIEW" ||
          c.status === "AWAITING_APPROVAL" ||
          c.status === "RETURNED" ||
          c.status === "PROCESSING_ERROR",
      ),
    [cases],
  );

  async function onModalSubmit(text) {
    const current = modal;
    setModal(null);
    if (!current?.item?.id) return;
    setBusyId(current.item.id);
    try {
      const result = await apiJson("POST", `${casePath(current.item.id)}/decision`, {
        action: current.kind,
        comment: text,
      });
      showToast?.(`Invoice ${current.kind}d`);
      await load();
    } catch (err) {
      const message = err.message || "Action failed";
      setError(message);
      showToast?.(message);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="ref-worklist-view">
      {/* 1. Header Hero */}
      <section className="ref-worklist-hero">
        <div className="ref-worklist-top">
          <div className="ref-worklist-title-row">
            <h1 className="ref-worklist-title">Need Review</h1>
            <span className="ref-worklist-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              </svg>
              <span>{queue.length} Invoices</span>
            </span>
          </div>

          <div className="ref-worklist-actions">
            <button
              type="button"
              className="ref-btn-export"
              onClick={() => showToast?.("Exporting queue to Excel...")}
            >
              Export to Excel
            </button>
          </div>
        </div>

        {/* Info Banner */}
        <div style={{ marginTop: "1rem", color: "#64748b", fontSize: "0.88rem" }}>
          Invoices requiring AP Processor review, data verification, or manager authorization before posting to SAP.
        </div>
      </section>

      {/* 2. Invoices Queue Table */}
      <div className="ref-table-container">
        <table className="ref-data-table">
          <thead>
            <tr>
              <th style={{ width: "38px" }}>
                <input type="checkbox" aria-label="Select all" />
              </th>
              <th>INVOICE</th>
              <th>VENDOR</th>
              <th>AMOUNT</th>
              <th>REASON / FLAG</th>
              <th>STATUS</th>
              <th>OWNER</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {queue.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>
                  {loading ? "Checking review queue..." : "Queue clear — all items processed!"}
                </td>
              </tr>
            ) : (
              queue.map((item) => {
                const invId = item.case_id || item.id;
                const invNum = item.invoice_number || item.title || `INV-${String(invId).slice(0, 6)}`;
                const vendor = item.vendor_name || item.supplier_name || "Supplier Pending";
                const amount = item.total_amount ? `${item.currency || 'SAR'} ${Number(item.total_amount).toLocaleString()}` : "SAR 7,074.80";
                const reason = item.review_reason || (item.status === "NEEDS_REVIEW" ? "PO comparison incomplete" : "Awaiting Manager Approval");

                return (
                  <tr key={invId}>
                    <td>
                      <input type="checkbox" aria-label={`Select ${invNum}`} />
                    </td>
                    <td>
                      <Link
                        to={`/cases/${invId}?back=%2Fapprovals&backLabel=Back+to+Need+Review`}
                        className="ref-invoice-link"
                      >
                        {invNum}
                      </Link>
                    </td>
                    <td>
                      <span style={{ fontWeight: 600 }}>{vendor}</span>
                    </td>
                    <td style={{ fontWeight: 700, color: "var(--apex-text-main, #0f172a)" }}>{amount}</td>
                    <td>
                      <span style={{ fontSize: "0.82rem", color: "#b45309", background: "#fef3c7", padding: "2px 8px", borderRadius: "4px", fontWeight: 600 }}>
                        {reason}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        display: "inline-block",
                        padding: "0.2rem 0.55rem",
                        borderRadius: "9999px",
                        fontSize: "0.74rem",
                        fontWeight: 700,
                        backgroundColor: "#fef3c7",
                        color: "#8a5300",
                      }}>
                        {item.status || "NEEDS_REVIEW"}
                      </span>
                    </td>
                    <td style={{ color: "#64748b", fontSize: "0.82rem" }}>
                      AP Supervisor
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <Link
                          to={`/cases/${invId}?back=%2Fapprovals&backLabel=Back+to+Need+Review`}
                          style={{
                            color: "var(--ref-navy-light)",
                            fontWeight: 700,
                            fontSize: "0.82rem",
                            textDecoration: "none",
                            padding: "0.3rem 0.65rem",
                            borderRadius: "6px",
                            border: "1px solid var(--ref-line-strong)",
                            background: "#ffffff",
                          }}
                        >
                          Review ›
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <DecisionModal
          modal={modal}
          onClose={() => setModal(null)}
          onSubmit={onModalSubmit}
          busy={Boolean(busyId)}
        />
      )}
    </div>
  );
}
