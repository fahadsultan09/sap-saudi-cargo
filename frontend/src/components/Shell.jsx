import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { canApprove, config, saveUserId } from "../lib/config";
import { apiJson } from "../lib/api";
import "../reference-portal.css";

export default function Shell({ userId, onUserChange, toast, session, localUser }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [reviewCount, setReviewCount] = useState(5);
  const location = useLocation();

  const user = localUser;
  const displayName = session?.name || user?.name || "Faizan Saleem";
  const roleLabel =
    (session?.role &&
      config.users.find((u) => u.role === session.role)?.roleLabel) ||
    user?.roleLabel ||
    session?.role ||
    "Processor";

  useEffect(() => {
    let alive = true;
    async function loadPendingCount() {
      try {
        const data = await apiJson("GET", "/api/v1/cases?limit=200");
        if (alive && data?.items) {
          const pending = data.items.filter(
            (c) =>
              c.status === "NEEDS_REVIEW" ||
              c.status === "AWAITING_APPROVAL" ||
              c.status === "RETURNED" ||
              c.status === "PROCESSING_ERROR"
          );
          if (pending.length > 0) {
            setReviewCount(pending.length);
          }
        }
      } catch (err) {
        // gracefully keep default
      }
    }
    loadPendingCount();
    return () => { alive = false; };
  }, [userId]);

  return (
    <div className="ref-shell">
      {/* 1. Shell Header */}
      <header className="ref-header">
        <div className="ref-header-left">
          <button
            type="button"
            className="ref-hamburger-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle Navigation"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
          
          <NavLink to="/" className="ref-brand">
            <div className="ref-brand-mark">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 17 12 22 22 17"></polyline>
                <polyline points="2 12 12 17 22 12"></polyline>
              </svg>
            </div>
            <div className="ref-brand-text">
              <span className="ref-brand-title">
                APEX AP
                <span style={{ fontSize: "0.65rem", padding: "1px 6px", borderRadius: "4px", background: "rgba(99, 102, 241, 0.2)", color: "#818cf8", fontWeight: 700, border: "1px solid rgba(99, 102, 241, 0.4)" }}>
                  AI 2.0
                </span>
              </span>
              <span className="ref-brand-sub">AUTONOMOUS INVOICE INTELLIGENCE</span>
            </div>
          </NavLink>
        </div>

        <div className="ref-header-center">
          <div className="ref-search-capsule">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.65 }}>
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              className="ref-search-input"
              placeholder="Search invoices, PO numbers, suppliers, or ledger accounts..."
            />
            <span style={{
              position: "absolute",
              right: "0.85rem",
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.14)",
              borderRadius: "6px",
              padding: "1px 6px",
              fontSize: "0.68rem",
              fontWeight: 600,
              color: "#94a3b8",
              pointerEvents: "none"
            }}>
              ⌘K
            </span>
          </div>
        </div>

        <div className="ref-header-right">
          <button type="button" className="ref-notify-btn" aria-label="Notifications" title="Live Agent Alerts">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
            <span className="ref-notify-dot"></span>
          </button>

          <div className="ref-user-menu" style={{ position: "relative" }}>
            <div
              className="ref-role-pill"
              onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
              title="Click to switch role"
            >
              <span className="ref-role-dot"></span>
              <span>{roleLabel}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ opacity: 0.7 }}>
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>

            {roleDropdownOpen && (
              <div className="ref-role-popover">
                <div className="ref-role-popover-header">Simulated Active Role</div>
                {config.users.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className={`ref-role-option ${u.id === user?.id ? "active" : ""}`}
                    onClick={() => {
                      onUserChange(u.id);
                      setRoleDropdownOpen(false);
                    }}
                  >
                    <span>{u.roleLabel} ({u.name})</span>
                    {u.id === user?.id && <span>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="ref-avatar" title={`Signed in as: ${displayName}`}>
            {displayName.slice(0, 2).toUpperCase()}
          </div>
        </div>
      </header>

      {/* 2. Shell Body */}
      <div className="ref-body">
        {sidebarOpen && (
          <aside className="ref-sidebar">
            <div className="ref-nav-group-title">AUTONOMOUS RUNWAY</div>
            <ul className="ref-nav-list">
              <li>
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) => `ref-nav-item${isActive ? " active" : ""}`}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7"></rect>
                    <rect x="14" y="3" width="7" height="7"></rect>
                    <rect x="14" y="14" width="7" height="7"></rect>
                    <rect x="3" y="14" width="7" height="7"></rect>
                  </svg>
                  <span>Dashboard</span>
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/intake"
                  className={({ isActive }) => `ref-nav-item${isActive ? " active" : ""}`}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                  <span>Intake & Ingestion</span>
                  <span className="ref-nav-badge-pill">AI 2.0</span>
                </NavLink>
              </li>
            </ul>

            <div className="ref-nav-group-title">INVOICE OPERATIONS</div>
            <ul className="ref-nav-list">
              <li>
                <NavLink
                  to="/worklist"
                  className={({ isActive }) => `ref-nav-item${isActive && !location.search.includes('type=') ? " active" : ""}`}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                  <span>Invoices Queue</span>
                </NavLink>
                <ul className="ref-sub-nav">
                  <li>
                    <NavLink
                      to="/worklist?type=All"
                      className={() => `ref-sub-item${location.pathname === '/worklist' && (location.search === '' || location.search.includes('type=All')) ? " active" : ""}`}
                    >
                      All Invoices
                    </NavLink>
                  </li>
                  <li>
                    <NavLink
                      to="/worklist?type=Direct"
                      className={() => `ref-sub-item${location.search.includes('type=Direct') ? " active" : ""}`}
                    >
                      Direct Suppliers
                    </NavLink>
                  </li>
                  <li>
                    <NavLink
                      to="/worklist?type=Intercompany"
                      className={() => `ref-sub-item${location.search.includes('type=Intercompany') ? " active" : ""}`}
                    >
                      Intercompany
                    </NavLink>
                  </li>
                </ul>
              </li>
            </ul>

            <div className="ref-nav-group-title">HUMAN-IN-THE-LOOP</div>
            <ul className="ref-nav-list">
              <li>
                <NavLink
                  to="/approvals"
                  className={({ isActive }) => `ref-nav-item${isActive ? " active" : ""}`}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 11l3 3L22 4"></path>
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                  </svg>
                  <span>Exceptions & Review</span>
                  <span className="ref-nav-count-badge">{reviewCount}</span>
                </NavLink>
              </li>
            </ul>

            {/* Sidebar Bottom: SAP S/4HANA Sync Card */}
            <div className="ref-sidebar-footer">
              <div className="ref-sync-card">
                <div className="ref-sync-head">
                  <span className="ref-sync-dot"></span>
                  <span className="ref-sync-title">SAP S/4HANA</span>
                </div>
                <div className="ref-sync-detail">3-Way PO Matching Engine</div>
                <div className="ref-sync-stat">Autonomous Rate: 98.4%</div>
              </div>
            </div>
          </aside>
        )}

        <main className="ref-main-content">
          <Outlet />
        </main>
      </div>

      {toast && (
        <div style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          background: "#002856",
          color: "#ffffff",
          padding: "12px 20px",
          borderRadius: "8px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
          fontSize: "0.9rem",
          fontWeight: 600,
          zIndex: 9999
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
