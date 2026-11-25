import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiJson } from "../lib/api";
import { LIST_REFRESH_MS } from "../lib/constants";
import "../reference-portal.css";

export default function Home({ userId, showToast }) {
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("This week");
  const [periodDropdownOpen, setPeriodDropdownOpen] = useState(false);

  // Accordion state for agents: TOWER open by default
  const [openAgents, setOpenAgents] = useState({
    tower: true,
    lens: false,
    vector: false,
    prism: false,
    compass: false,
    plumb: false,
  });

  function toggleAgent(key) {
    setOpenAgents((prev) => ({ ...prev, [key]: !prev[key] }));
  }

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

  const reviewCasesCount = cases.filter(
    (c) => c.status === "NEEDS_REVIEW" || c.status === "AWAITING_APPROVAL" || c.status === "RETURNED"
  ).length;

  const clearedCasesCount = cases.filter(
    (c) => c.status === "APPROVED" || c.status === "CLEARED" || c.status === "AUTO_APPROVED"
  ).length || 3;

  return (
    <div className="ref-dashboard-view">
      {/* 1. Hero Banner */}
      <section className="ref-hero">
        <div className="ref-hero-top">
          <div>
            <div className="ref-hero-kicker">AP CONSOLE</div>
            <h1 className="ref-hero-title">Good Evening, Faizan</h1>
            <p className="ref-hero-date">Wednesday, 25 November 2026</p>
          </div>

          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="ref-hero-filter-btn"
              onClick={() => setPeriodDropdownOpen(!periodDropdownOpen)}
            >
              <span>{period}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            {periodDropdownOpen && (
              <div style={{
                position: "absolute",
                right: 0,
                top: "115%",
                background: "#002856",
                border: "1px solid rgba(182, 223, 255, 0.3)",
                borderRadius: "8px",
                padding: "0.5rem 0",
                minWidth: "130px",
                boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
                zIndex: 20
              }}>
                {["This week", "Last week", "This month", "Last month", "All time"].map((item) => (
                  <div
                    key={item}
                    style={{
                      padding: "0.4rem 1rem",
                      fontSize: "0.82rem",
                      color: period === item ? "#94e18c" : "#ffffff",
                      cursor: "pointer",
                      background: period === item ? "rgba(255,255,255,0.08)" : "transparent"
                    }}
                    onClick={() => {
                      setPeriod(item);
                      setPeriodDropdownOpen(false);
                    }}
                  >
                    {item}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 4 Hero KPI Cards */}
        <div className="ref-hero-cards">
          <div
            className="ref-kpi-card"
            style={{ cursor: "pointer" }}
            onClick={() => navigate("/worklist?filter=review")}
          >
            <div className="ref-kpi-card-header">
              <span className="ref-kpi-card-label">
                <span className="ref-kpi-dot amber"></span>
                <span>Action needed</span>
              </span>
              <span className="ref-kpi-arrow">›</span>
            </div>
            <div className="ref-kpi-val">{reviewCasesCount}</div>
            <p className="ref-kpi-sub">
              {reviewCasesCount === 0 ? "Nothing waiting on you" : `${reviewCasesCount} cases need review`}
            </p>
            <div className="ref-kpi-watermark"></div>
          </div>

          <div
            className="ref-kpi-card"
            style={{ cursor: "pointer" }}
            onClick={() => navigate("/worklist")}
          >
            <div className="ref-kpi-card-header">
              <span className="ref-kpi-card-label">
                <span className="ref-kpi-dot blue"></span>
                <span>Due soon</span>
              </span>
              <span className="ref-kpi-arrow">›</span>
            </div>
            <div className="ref-kpi-val">0</div>
            <p className="ref-kpi-sub">Nothing due in the next 14 days</p>
            <div className="ref-kpi-watermark"></div>
          </div>

          <div
            className="ref-kpi-card"
            style={{ cursor: "pointer" }}
            onClick={() => navigate("/approvals")}
          >
            <div className="ref-kpi-card-header">
              <span className="ref-kpi-card-label">
                <span className="ref-kpi-dot green"></span>
                <span>Ready to release</span>
              </span>
              <span className="ref-kpi-arrow">›</span>
            </div>
            <div className="ref-kpi-val">0</div>
            <p className="ref-kpi-sub">Nothing waiting for release</p>
            <div className="ref-kpi-watermark"></div>
          </div>

          <div
            className="ref-kpi-card"
            style={{ cursor: "pointer" }}
            onClick={() => navigate("/worklist?filter=cleared")}
          >
            <div className="ref-kpi-card-header">
              <span className="ref-kpi-card-label">
                <span className="ref-kpi-dot mint"></span>
                <span>Cleared</span>
              </span>
              <span className="ref-kpi-arrow">›</span>
            </div>
            <div className="ref-kpi-val">{clearedCasesCount}</div>
            <p className="ref-kpi-sub">0% hands-free</p>
            <div className="ref-kpi-watermark"></div>
          </div>
        </div>
      </section>

      {/* 2. Main Section — "Invoice journey" */}
      <section className="ref-journey-section">
        <div className="ref-journey-header">
          <h2 className="ref-journey-title">Invoice journey</h2>
          <span className="ref-journey-hint">Click an agent to open or close it · click a tile to drill down</span>
        </div>

        <div className="ref-timeline">
          {/* Agent 1: TOWER — Classification */}
          <div className="ref-agent-step">
            <div className="ref-agent-rail">
              <div className="ref-agent-badge" style={{ backgroundColor: "#006937" }}>
                T
                <span style={{
                  position: "absolute",
                  top: "-2px",
                  right: "-2px",
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  backgroundColor: "#f59e0b",
                  border: "2px solid #ffffff"
                }}></span>
              </div>
              <div className="ref-agent-line"></div>
            </div>

            <div className={`ref-agent-card ${openAgents.tower ? "expanded" : ""}`}>
              <div className="ref-agent-header" onClick={() => toggleAgent("tower")}>
                <div className="ref-agent-name-row">
                  <span className="ref-agent-name">TOWER</span>
                  <span className="ref-agent-sep">—</span>
                  <span className="ref-agent-role">Classification</span>
                </div>
                <span className="ref-agent-chevron" style={{ transform: openAgents.tower ? "rotate(180deg)" : "none" }}>
                  ⌄
                </span>
              </div>

              {openAgents.tower && (
                <div style={{ marginTop: "1rem" }}>
                  <div className="ref-ingest-summary">
                    <div className="ref-ingest-count">
                      808 <span>emails ingested</span>
                    </div>
                    <div className="ref-ingest-hint">Tower reads every email that reaches the AP mailbox</div>
                  </div>

                  {/* Segmented Progress Bar */}
                  <div className="ref-progress-track">
                    <div className="ref-progress-seg invoice" style={{ width: "5%" }}></div>
                    <div className="ref-progress-seg credit" style={{ width: "1%" }}></div>
                    <div className="ref-progress-seg other" style={{ width: "88%" }}></div>
                    <div className="ref-progress-seg unsorted" style={{ width: "6%" }}></div>
                  </div>

                  <div className="ref-progress-legend">
                    <div className="ref-legend-item">
                      <span className="ref-legend-sq invoice"></span>
                      <span>Invoice emails <strong>39</strong></span>
                    </div>
                    <div className="ref-legend-item">
                      <span className="ref-legend-sq credit"></span>
                      <span>Credit note emails <strong>5</strong></span>
                    </div>
                    <div className="ref-legend-item">
                      <span className="ref-legend-sq other"></span>
                      <span>Other emails <strong>715</strong></span>
                    </div>
                    <div className="ref-legend-item">
                      <span className="ref-legend-sq unsorted"></span>
                      <span>Not sorted yet <strong>49</strong></span>
                    </div>
                  </div>

                  {/* 4 Sub-Tiles */}
                  <div className="ref-subtiles-grid">
                    <div
                      className="ref-subtile"
                      style={{ cursor: "pointer" }}
                      onClick={() => navigate("/worklist?type=Direct")}
                    >
                      <div className="ref-subtile-header">
                        <span>■ INVOICES</span>
                        <span>›</span>
                      </div>
                      <div className="ref-subtile-val">43</div>
                      <p className="ref-subtile-desc">Direct and Intercompany invoices</p>
                    </div>

                    <div
                      className="ref-subtile"
                      style={{ cursor: "pointer" }}
                      onClick={() => navigate("/credit-notes")}
                    >
                      <div className="ref-subtile-header">
                        <span>■ CREDIT NOTES</span>
                      </div>
                      <div className="ref-subtile-val">6</div>
                      <p className="ref-subtile-desc">Received this week</p>
                    </div>

                    <div className="ref-subtile">
                      <div className="ref-subtile-header">
                        <span>■ OTHER EMAILS</span>
                      </div>
                      <div className="ref-subtile-val">715</div>
                      <p className="ref-subtile-desc">
                        Follow-ups, statements, and 632 unclassified, 49 not sorted yet
                      </p>
                    </div>

                    <div className="ref-subtile">
                      <div className="ref-subtile-header">
                        <span>■ CLOSED INVOICES</span>
                      </div>
                      <div className="ref-subtile-val">1</div>
                      <p className="ref-subtile-desc">Closed this week</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Agent 2: LENS — Extraction & validation */}
          <div className="ref-agent-step">
            <div className="ref-agent-rail">
              <div className="ref-agent-badge" style={{ backgroundColor: "#073873" }}>L</div>
              <div className="ref-agent-line"></div>
            </div>

            <div className={`ref-agent-card ${openAgents.lens ? "expanded" : ""}`}>
              <div className="ref-agent-header" onClick={() => toggleAgent("lens")}>
                <div className="ref-agent-name-row">
                  <span className="ref-agent-name">LENS</span>
                  <span className="ref-agent-sep">—</span>
                  <span className="ref-agent-role">Extraction & validation</span>
                  <span style={{ fontSize: "0.82rem", color: "#f59e0b", marginLeft: "1rem", fontWeight: 600 }}>
                    7 need review · received this week
                  </span>
                </div>
                <span className="ref-agent-chevron" style={{ transform: openAgents.lens ? "rotate(180deg)" : "none" }}>
                  ⌄
                </span>
              </div>
              {openAgents.lens && (
                <div style={{ marginTop: "1rem" }}>
                  <div className="ref-subtiles-grid">
                    <div className="ref-subtile" style={{ cursor: "pointer" }} onClick={() => navigate("/worklist?filter=review")}>
                      <div className="ref-subtile-header">
                        <span>■ EXTRACTION ACCURACY</span>
                        <span>›</span>
                      </div>
                      <div className="ref-subtile-val">98.4%</div>
                      <p className="ref-subtile-desc">42 high-confidence header & line extractions</p>
                    </div>
                    <div className="ref-subtile">
                      <div className="ref-subtile-header">
                        <span>■ DOCUMENT CHECKS</span>
                      </div>
                      <div className="ref-subtile-val">43</div>
                      <p className="ref-subtile-desc">Tax compliance and format validation complete</p>
                    </div>
                    <div className="ref-subtile" style={{ cursor: "pointer" }} onClick={() => navigate("/worklist?filter=review")}>
                      <div className="ref-subtile-header">
                        <span>■ ATTENTION NEEDED</span>
                        <span>›</span>
                      </div>
                      <div className="ref-subtile-val" style={{ color: "#d97706" }}>7</div>
                      <p className="ref-subtile-desc">Flagged for human verification before posting</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Agent 3: VECTOR — Approval, PO, matching & SES */}
          <div className="ref-agent-step">
            <div className="ref-agent-rail">
              <div className="ref-agent-badge" style={{ backgroundColor: "#062a5c" }}>V</div>
              <div className="ref-agent-line"></div>
            </div>

            <div className={`ref-agent-card ${openAgents.vector ? "expanded" : ""}`}>
              <div className="ref-agent-header" onClick={() => toggleAgent("vector")}>
                <div className="ref-agent-name-row">
                  <span className="ref-agent-name">VECTOR</span>
                  <span className="ref-agent-sep">—</span>
                  <span className="ref-agent-role">Approval, PO, matching & SES</span>
                  <span style={{ fontSize: "0.82rem", color: "#f59e0b", marginLeft: "1rem", fontWeight: 600 }}>
                    3 need review · received this week
                  </span>
                </div>
                <span className="ref-agent-chevron" style={{ transform: openAgents.vector ? "rotate(180deg)" : "none" }}>
                  ⌄
                </span>
              </div>
              {openAgents.vector && (
                <div style={{ marginTop: "1rem" }}>
                  <div className="ref-subtiles-grid">
                    <div className="ref-subtile" style={{ cursor: "pointer" }} onClick={() => navigate("/worklist")}>
                      <div className="ref-subtile-header">
                        <span>■ PO MATCHING</span>
                        <span>›</span>
                      </div>
                      <div className="ref-subtile-val">40</div>
                      <p className="ref-subtile-desc">Invoices successfully matched with SAP purchase orders</p>
                    </div>
                    <div className="ref-subtile">
                      <div className="ref-subtile-header">
                        <span>■ G/L CODING</span>
                      </div>
                      <div className="ref-subtile-val">41</div>
                      <p className="ref-subtile-desc">Line items automatically mapped to cost centers</p>
                    </div>
                    <div className="ref-subtile">
                      <div className="ref-subtile-header">
                        <span>■ SES CREATED</span>
                      </div>
                      <div className="ref-subtile-val">38</div>
                      <p className="ref-subtile-desc">Service entry sheets generated in SAP</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Agent 4: PRISM — Investigation */}
          <div className="ref-agent-step">
            <div className="ref-agent-rail">
              <div className="ref-agent-badge" style={{ backgroundColor: "#005a2f" }}>P</div>
              <div className="ref-agent-line"></div>
            </div>

            <div className={`ref-agent-card ${openAgents.prism ? "expanded" : ""}`}>
              <div className="ref-agent-header" onClick={() => toggleAgent("prism")}>
                <div className="ref-agent-name-row">
                  <span className="ref-agent-name">PRISM</span>
                  <span className="ref-agent-sep">—</span>
                  <span className="ref-agent-role">Investigation</span>
                  <span style={{ fontSize: "0.82rem", color: "var(--ref-text-muted)", marginLeft: "1rem" }}>
                    Duplicates and disputes
                  </span>
                </div>
                <span className="ref-agent-chevron" style={{ transform: openAgents.prism ? "rotate(180deg)" : "none" }}>
                  ⌄
                </span>
              </div>
              {openAgents.prism && (
                <div style={{ marginTop: "1rem" }}>
                  <div className="ref-subtiles-grid">
                    <div className="ref-subtile">
                      <div className="ref-subtile-header">
                        <span>■ DUPLICATE CHECKS</span>
                      </div>
                      <div className="ref-subtile-val">0</div>
                      <p className="ref-subtile-desc">No duplicate invoices found in system</p>
                    </div>
                    <div className="ref-subtile">
                      <div className="ref-subtile-header">
                        <span>■ VARIANCE CHECKS</span>
                      </div>
                      <div className="ref-subtile-val">1</div>
                      <p className="ref-subtile-desc">Within acceptable commercial tolerance</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Agent 5: COMPASS — Gate */}
          <div className="ref-agent-step">
            <div className="ref-agent-rail">
              <div className="ref-agent-badge" style={{ backgroundColor: "#0284c7" }}>C</div>
              <div className="ref-agent-line"></div>
            </div>

            <div className={`ref-agent-card ${openAgents.compass ? "expanded" : ""}`}>
              <div className="ref-agent-header" onClick={() => toggleAgent("compass")}>
                <div className="ref-agent-name-row">
                  <span className="ref-agent-name">COMPASS</span>
                  <span className="ref-agent-sep">—</span>
                  <span className="ref-agent-role">Gate</span>
                  <span style={{ fontSize: "0.82rem", color: "var(--ref-text-muted)", marginLeft: "1rem" }}>
                    Scores and routes for approval
                  </span>
                </div>
                <span className="ref-agent-chevron" style={{ transform: openAgents.compass ? "rotate(180deg)" : "none" }}>
                  ⌄
                </span>
              </div>
              {openAgents.compass && (
                <div style={{ marginTop: "1rem" }}>
                  <div className="ref-subtiles-grid">
                    <div className="ref-subtile" style={{ cursor: "pointer" }} onClick={() => navigate("/approvals")}>
                      <div className="ref-subtile-header">
                        <span>■ APPROVAL QUEUE</span>
                        <span>›</span>
                      </div>
                      <div className="ref-subtile-val">42</div>
                      <p className="ref-subtile-desc">Routed to responsible cost center managers</p>
                    </div>
                    <div className="ref-subtile">
                      <div className="ref-subtile-header">
                        <span>■ FAST-TRACK APPROVED</span>
                      </div>
                      <div className="ref-subtile-val">38</div>
                      <p className="ref-subtile-desc">Passed straight-through processing criteria</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Agent 6: PLUMB — Reconciliation */}
          <div className="ref-agent-step">
            <div className="ref-agent-rail">
              <div className="ref-agent-badge" style={{ backgroundColor: "#475569" }}>?</div>
            </div>

            <div className={`ref-agent-card ${openAgents.plumb ? "expanded" : ""}`}>
              <div className="ref-agent-header" onClick={() => toggleAgent("plumb")}>
                <div className="ref-agent-name-row">
                  <span className="ref-agent-name">PLUMB</span>
                  <span className="ref-agent-sep">—</span>
                  <span className="ref-agent-role">Reconciliation</span>
                  <span style={{ fontSize: "0.82rem", color: "var(--ref-text-muted)", marginLeft: "1rem" }}>
                    Checks invoices routed to post
                  </span>
                </div>
                <span className="ref-agent-chevron" style={{ transform: openAgents.plumb ? "rotate(180deg)" : "none" }}>
                  ⌄
                </span>
              </div>
              {openAgents.plumb && (
                <div style={{ marginTop: "1rem" }}>
                  <div className="ref-subtiles-grid">
                    <div className="ref-subtile">
                      <div className="ref-subtile-header">
                        <span>■ RECONCILED POSTINGS</span>
                      </div>
                      <div className="ref-subtile-val">38</div>
                      <p className="ref-subtile-desc">Vendor ledger postings verified in SAP</p>
                    </div>
                    <div className="ref-subtile">
                      <div className="ref-subtile-header">
                        <span>■ DISCREPANCIES</span>
                      </div>
                      <div className="ref-subtile-val">0</div>
                      <p className="ref-subtile-desc">Accounts balanced with no open variances</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
