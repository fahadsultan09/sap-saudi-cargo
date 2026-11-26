import React, { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { canApprove, config, saveUserId } from "../lib/config";
import "../reference-portal.css";

export default function Shell({ userId, onUserChange, toast, session, localUser }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();

  const user = localUser;
  const displayName = session?.name || user?.name || "Faizan Saleem";
  const roleLabel =
    (session?.role &&
      config.users.find((u) => u.role === session.role)?.roleLabel) ||
    user?.roleLabel ||
    session?.role ||
    "AP Processor";

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
            <div className="ref-brand-mark">AP</div>
            <div className="ref-brand-text">
              <span className="ref-brand-title">AP Console</span>
              <span className="ref-brand-sub">AP AUTOMATION · INVOICE PROCESSING</span>
            </div>
          </NavLink>
        </div>

        <div className="ref-header-center">
          <div className="ref-search-capsule">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              className="ref-search-input"
              placeholder="Search case, vendor, invoice number or PO"
            />
          </div>
        </div>

        <div className="ref-header-right">
          <button type="button" className="ref-notify-btn" aria-label="Notifications">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
          </button>

          <div className="ref-role-pill">
            <span className="ref-role-dot"></span>
            <span>{roleLabel}</span>
          </div>

          <div className="ref-avatar" title={`Account: ${displayName}`}>
            FS
          </div>
        </div>
      </header>

      {/* 2. Shell Body */}
      <div className="ref-body">
        {sidebarOpen && (
          <aside className="ref-sidebar">
            <div className="ref-nav-group-title">WORKSPACE</div>
            <ul className="ref-nav-list">
              <li>
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) => `ref-nav-item${isActive ? " active" : ""}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                  to="/process/new"
                  className={({ isActive }) => `ref-nav-item${isActive ? " active" : ""}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                    <polyline points="22,6 12,13 2,6"></polyline>
                  </svg>
                  <span>Intake</span>
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/worklist"
                  className={({ isActive }) => `ref-nav-item${isActive ? " active" : ""}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                  <span>Invoices</span>
                </NavLink>
                <ul className="ref-sub-nav">
                  <li>
                    <NavLink
                      to="/worklist?type=All"
                      className={({ isActive }) => `ref-sub-item${isActive && location.search.includes('type=All') ? " active" : ""}`}
                    >
                      All invoices
                    </NavLink>
                  </li>
                  <li>
                    <NavLink
                      to="/worklist?type=Direct"
                      className={({ isActive }) => `ref-sub-item${location.search.includes('type=Direct') ? " active" : ""}`}
                    >
                      Direct
                    </NavLink>
                  </li>
                  <li>
                    <NavLink
                      to="/worklist?type=Intercompany"
                      className={({ isActive }) => `ref-sub-item${location.search.includes('type=Intercompany') ? " active" : ""}`}
                    >
                      Intercompany
                    </NavLink>
                  </li>
                </ul>
              </li>
              <li>
                <NavLink
                  to="/credit-notes"
                  className={({ isActive }) => `ref-nav-item${isActive ? " active" : ""}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                    <line x1="7" y1="12" x2="17" y2="12"></line>
                  </svg>
                  <span>Credit notes</span>
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/reconciliations"
                  className={({ isActive }) => `ref-nav-item${isActive ? " active" : ""}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 3 21 3 21 8"></polyline>
                    <line x1="4" y1="20" x2="21" y2="3"></line>
                    <polyline points="21 16 21 21 16 21"></polyline>
                    <line x1="15" y1="15" x2="21" y2="21"></line>
                    <line x1="4" y1="4" x2="9" y2="9"></line>
                  </svg>
                  <span>Reconciliations</span>
                </NavLink>
              </li>
            </ul>

            <div className="ref-nav-group-title">YOUR WORK</div>
            <ul className="ref-nav-list">
              <li>
                <NavLink
                  to="/approvals"
                  className={({ isActive }) => `ref-nav-item${isActive ? " active" : ""}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 11l3 3L22 4"></path>
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                  </svg>
                  <span>Need Review</span>
                </NavLink>
              </li>
            </ul>
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
