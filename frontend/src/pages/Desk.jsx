import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiJson } from "../lib/api";
import { LIST_REFRESH_MS } from "../lib/constants";
import "../reference-portal.css";

export default function Desk({ userId, showToast }) {
  const navigate = useNavigate();
  const [params, setSearchParams] = useSearchParams();
  const filter = params.get("filter") || "";
  const typeFilter = params.get("type") || "All";

  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [scope, setScope] = useState("Team"); // Me | Team
  const [statusFilter, setStatusFilter] = useState("open"); // open | closed
  const [viewMode, setViewMode] = useState("table"); // table | split

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

  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      const q = searchQuery.toLowerCase().trim();
      const matchSearch =
        !q ||
        (c.invoice_number && c.invoice_number.toLowerCase().includes(q)) ||
        (c.vendor_name && c.vendor_name.toLowerCase().includes(q)) ||
        (c.supplier_name && c.supplier_name.toLowerCase().includes(q)) ||
        (c.po_number && c.po_number.toLowerCase().includes(q)) ||
        (c.case_id && c.case_id.toLowerCase().includes(q));

      const matchStatus =
        statusFilter === "open"
          ? c.status !== "APPROVED" && c.status !== "REJECTED" && c.status !== "CLEARED"
          : c.status === "APPROVED" || c.status === "REJECTED" || c.status === "CLEARED";

      return matchSearch && matchStatus;
    });
  }, [cases, searchQuery, statusFilter]);

  const needReviewCount = cases.filter(
    (c) => c.status === "NEEDS_REVIEW" || c.status === "AWAITING_APPROVAL" || c.status === "RETURNED"
  ).length;

  return (
    <div className="ref-worklist-view">
      {/* 1. Worklist Hero */}
      <section className="ref-worklist-hero">
        <div className="ref-worklist-top">
          <div className="ref-worklist-title-row">
            <h1 className="ref-worklist-title">Direct Invoices</h1>
            <span className="ref-worklist-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              </svg>
              <span>Invoices {cases.length}</span>
            </span>
          </div>

          <div className="ref-worklist-actions">
            <div className="ref-toggle-group">
              <button
                type="button"
                className={`ref-toggle-btn ${scope === "Me" ? "active" : ""}`}
                onClick={() => setScope("Me")}
              >
                Me
              </button>
              <button
                type="button"
                className={`ref-toggle-btn ${scope === "Team" ? "active" : ""}`}
                onClick={() => setScope("Team")}
              >
                Team
              </button>
            </div>

            <button
              type="button"
              className="ref-btn-export"
              onClick={() => showToast?.("Exporting invoices list to Excel...")}
            >
              Export to Excel
            </button>
          </div>
        </div>

        {/* 4 Summary / Filter Cards */}
        <div className="ref-filter-cards">
          <div className="ref-filter-card">
            <div className="ref-filter-card-header">
              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <span>📍 By Region</span>
              </div>
              <span>⌄</span>
            </div>
            <div className="ref-filter-card-val">
              2 <span>regions</span>
            </div>
            <p className="ref-filter-card-sub">Top: Unassigned · {cases.length} invoices</p>
          </div>

          <div className="ref-filter-card">
            <div className="ref-filter-card-header">
              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <span>📑 By Department</span>
              </div>
              <span>⌄</span>
            </div>
            <div className="ref-filter-card-val">
              14 <span>departments</span>
            </div>
            <p className="ref-filter-card-sub">Top: Not mapped · {cases.length} invoices</p>
          </div>

          <div className="ref-filter-card">
            <div className="ref-filter-card-header">
              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <span>🏢 By Vendor</span>
              </div>
              <span>⌄</span>
            </div>
            <div className="ref-filter-card-val">
              {Math.min(cases.length, 59)} <span>vendors</span>
            </div>
            <p className="ref-filter-card-sub">Top: Cargo Terminals Ltd · {cases.length} invoices</p>
          </div>

          <div
            className="ref-filter-card"
            style={{ cursor: "pointer" }}
            onClick={() => setStatusFilter("open")}
          >
            <div className="ref-filter-card-header">
              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", color: "#002856" }}>
                <span>☑ Need Review</span>
              </div>
              <span>→</span>
            </div>
            <div className="ref-filter-card-val">
              {needReviewCount} <span>invoices</span>
            </div>
            <p className="ref-filter-card-sub">Active workflow items requiring attention</p>
          </div>
        </div>
      </section>

      {/* 2. Table Controls Row */}
      <div className="ref-table-controls">
        <div className="ref-controls-left">
          <div className="ref-table-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ color: "#94a3b8" }}>
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              placeholder="Search invoice no., vendor or PO"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="ref-dropdown-btn">
            <span>All time</span>
            <span style={{ fontSize: "0.7rem" }}>⌄</span>
          </div>

          <button type="button" className="ref-btn-all-filters">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
            </svg>
            <span>All filters</span>
          </button>
        </div>

        <div className="ref-controls-right">
          <div className="ref-toggle-group" style={{ background: "#ffffff", border: "1px solid var(--ref-line)" }}>
            <button
              type="button"
              className={`ref-toggle-btn ${statusFilter === "open" ? "active" : ""}`}
              style={{ color: statusFilter === "open" ? "#002856" : "#64748b" }}
              onClick={() => setStatusFilter("open")}
            >
              Open
            </button>
            <button
              type="button"
              className={`ref-toggle-btn ${statusFilter === "closed" ? "active" : ""}`}
              style={{ color: statusFilter === "closed" ? "#002856" : "#64748b" }}
              onClick={() => setStatusFilter("closed")}
            >
              Closed
            </button>
          </div>

          <div className="ref-toggle-group" style={{ background: "#ffffff", border: "1px solid var(--ref-line)" }}>
            <button
              type="button"
              className={`ref-toggle-btn ${viewMode === "table" ? "active" : ""}`}
              style={{ color: viewMode === "table" ? "#002856" : "#64748b" }}
              onClick={() => setViewMode("table")}
            >
              Table
            </button>
            <button
              type="button"
              className={`ref-toggle-btn ${viewMode === "split" ? "active" : ""}`}
              style={{ color: viewMode === "split" ? "#002856" : "#64748b" }}
              onClick={() => setViewMode("split")}
            >
              Split
            </button>
          </div>
        </div>
      </div>

      {/* 3. Modern Reference Invoices Table */}
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
              <th>SOURCE</th>
              <th>STATION · REGION</th>
              <th>DEPARTMENT</th>
              <th>PO NUMBER</th>
              <th>STATUS</th>
              <th>WHOSE COURT</th>
              <th>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {filteredCases.length === 0 ? (
              <tr>
                <td colSpan="11" style={{ textAlign: "center", padding: "2.5rem", color: "#64748b" }}>
                  {loading ? "Loading invoices..." : "No invoices found for this filter."}
                </td>
              </tr>
            ) : (
              filteredCases.map((item) => {
                const invId = item.case_id || item.id;
                const invNum = item.invoice_number || item.title || `INV-${String(invId).slice(0, 6)}`;
                const vendor = item.vendor_name || item.supplier_name || "Hong Kong Air Cargo Terminals Limited";
                const amount = item.total_amount ? `${item.currency || 'SAR'} ${Number(item.total_amount).toLocaleString()}` : "SAR 7,074.80";
                const po = item.po_number || "4200011755";
                const source = item.file_name ? "Upload" : "Email";
                const station = item.company_code === "1000" ? "JED · Western" : "RUH · Central";
                const dept = item.department || "Operations";
                const court = item.status === "APPROVED" ? "Finance" : "AP";

                return (
                  <tr key={invId}>
                    <td>
                      <input type="checkbox" aria-label={`Select ${invNum}`} />
                    </td>
                    <td>
                      <Link
                        to={`/cases/${invId}?back=%2Fworklist&backLabel=Back+to+Invoices`}
                        className="ref-invoice-link"
                      >
                        {invNum}
                      </Link>
                    </td>
                    <td>
                      <span style={{ fontWeight: 600 }}>{vendor}</span>
                      <span className="ref-notes-badge">Notes</span>
                    </td>
                    <td style={{ fontWeight: 700, color: "#002856" }}>{amount}</td>
                    <td>
                      <span style={{ fontSize: "0.8rem", color: "#475569", background: "#f1f5f9", padding: "2px 6px", borderRadius: "4px" }}>
                        {source}
                      </span>
                    </td>
                    <td style={{ color: "#475569", fontSize: "0.82rem" }}>{station}</td>
                    <td style={{ color: "#475569", fontSize: "0.82rem" }}>{dept}</td>
                    <td style={{ color: "#002856", fontWeight: 600, fontSize: "0.82rem" }}>{po}</td>
                    <td>
                      <span style={{
                        display: "inline-block",
                        padding: "0.2rem 0.55rem",
                        borderRadius: "9999px",
                        fontSize: "0.74rem",
                        fontWeight: 700,
                        backgroundColor: item.status === "APPROVED" ? "#e6f0eb" : "#fef3c7",
                        color: item.status === "APPROVED" ? "#006937" : "#8a5300",
                      }}>
                        {item.status || "NEEDS_REVIEW"}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: "0.8rem", fontWeight: 600, color: court === "AP" ? "#006937" : "#64748b" }}>
                        {court}
                      </span>
                    </td>
                    <td>
                      <Link
                        to={`/cases/${invId}?back=%2Fworklist&backLabel=Back+to+Invoices`}
                        style={{ color: "var(--ref-navy-light)", fontWeight: 700, fontSize: "0.82rem", textDecoration: "none" }}
                      >
                        Open ›
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
