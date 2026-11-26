import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  hasSapComparisonData,
  mapComparisons,
  mapDuplicateCases,
  mapIssues,
  mapVerdict,
} from "../lib/comparison";
import { outcomeLabel } from "../lib/pipeline";

const EARLIER_PREVIEW = 2;

export default function ComparisonPanel({
  caseRow,
  compact = false,
  onGoFields,
  canDecide = false,
  canEdit = false,
}) {
  const comparisons = mapComparisons(caseRow);
  const verdict = mapVerdict(caseRow);
  const issues = mapIssues(caseRow);
  const sapLive = hasSapComparisonData(caseRow);
  const duplicates = mapDuplicateCases(caseRow);
  const financeOnly = comparisons.length > 0 && comparisons.every((r) => r.fromChecks);
  const [showAllEarlier, setShowAllEarlier] = useState(false);

  const earlierVisible =
    showAllEarlier || duplicates.length <= EARLIER_PREVIEW
      ? duplicates
      : duplicates.slice(0, EARLIER_PREVIEW);
  const earlierHidden = Math.max(0, duplicates.length - earlierVisible.length);

  if (!verdict.hasData && !comparisons.length && !duplicates.length) {
    return (
      <div className={`comparison-panel${compact ? " comparison-panel--compact" : ""}`}>
        <div className="empty-note empty-note--compact">
          <strong>Nothing to compare yet</strong>
          <span>Finance checks and SAP rows show here after agents finish.</span>
          {onGoFields ? (
            <div className="comparison-panel__actions">
              <button type="button" className="btn btn-primary btn-compact" onClick={onGoFields}>
                Check fields
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`comparison-panel${compact ? " comparison-panel--compact" : ""}`}>
      <section className={`verdict-card verdict-card--${verdict.tone}`}>
        <p className="section-label">Verdict</p>
        <h3>{verdict.headline}</h3>
        {verdict.canPay != null ? (
          <p className="muted verdict-card__lede">
            {verdict.canPay
              ? "Looks clear to approve if the PDF matches."
              : "Needs a careful look before approval."}
          </p>
        ) : null}
        {verdict.points.length ? (
          <ul className="verdict-points">
            {verdict.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        {!sapLive && comparisons.length ? (
          <p className="muted comparison-panel__hint">
            Finance checks shown — full SAP rows need gateway source verdict.
          </p>
        ) : null}
      </section>

      {issues.count > 0 ? (
        <section className="issues-block">
          <h4 className="comparison-panel__h">Issues · {issues.count}</h4>
          <ul className="issues-list">
            {issues.rows.map((row, i) => (
              <li key={`${row.area}-${i}`}>
                {row.area ? <span className="issues-list__area">{row.area}</span> : null}
                <strong>{row.title}</strong>
                {row.detail ? <span className="muted">{row.detail}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {duplicates.length ? (
        <section className="dup-cases-block">
          <div className="dup-cases-block__head">
            <h4 className="comparison-panel__h">Earlier cases · {duplicates.length}</h4>
            {earlierHidden > 0 || showAllEarlier ? (
              <button
                type="button"
                className="btn btn-ghost btn-compact dup-cases-block__toggle"
                onClick={() => setShowAllEarlier((v) => !v)}
                aria-expanded={showAllEarlier}
              >
                {showAllEarlier ? "Show less" : `Show all ${duplicates.length}`}
              </button>
            ) : null}
          </div>
          <ul className="dup-cases-list">
            {earlierVisible.map((d) => (
              <li key={d.id}>
                <Link className="dup-cases-list__link" to={`/review/${d.id}`}>
                  <span className="dup-cases-list__id">{d.id.slice(0, 8)}…</span>
                  <span className={`pill pill-${statusPill(d.status)}`}>
                    {duplicateStatusLabel(d.status)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {earlierHidden > 0 ? (
            <p className="muted dup-cases-block__more">
              +{earlierHidden} more — expand to compare before approving.
            </p>
          ) : null}
        </section>
      ) : null}

      {comparisons.length ? (
        <section className="compare-table-wrap">
          <h4 className="comparison-panel__h">
            {sapLive && !financeOnly ? "Invoice vs SAP" : "Checks"}
          </h4>
          <table className="compare-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Invoice</th>
                <th>SAP</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map((row) => (
                <tr key={row.id} className={row.differs ? "compare-table__differs" : undefined}>
                  <td>{row.field}</td>
                  <td>{row.invoice}</td>
                  <td>{row.sap}</td>
                  <td>
                    <span
                      className={`pill pill-${
                        row.tone === "ok"
                          ? "approved"
                          : row.tone === "err"
                            ? "rejected"
                            : row.tone === "warn"
                              ? "review"
                              : "working"
                      }`}
                    >
                      {row.resultLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <p className="muted comparison-panel__sap-empty">
          {duplicates.length
            ? "No SAP field rows — duplicate fingerprint is the flag. Confirm the PDF, then decide."
            : "No SAP field rows yet. Confirm extracted fields against the PDF."}
        </p>
      )}

      {!compact ? (
        <section className="comparison-panel__next" aria-label="What to do next">
          <div className="comparison-panel__actions">
            {onGoFields ? (
              <button type="button" className="btn btn-ghost btn-compact" onClick={onGoFields}>
                Check fields
              </button>
            ) : null}
            {canDecide ? (
              <span className="muted comparison-panel__next-hint">
                Decide with Approve / Send back / Reject below.
              </span>
            ) : canEdit ? (
              <span className="muted comparison-panel__next-hint">
                Save corrections, then switch to Approver.
              </span>
            ) : (
              <span className="muted comparison-panel__next-hint">
                Switch role to edit or decide.
              </span>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function duplicateStatusLabel(status) {
  const s = String(status || "").toUpperCase();
  if (s === "PROCESSING_ERROR") return "Processing error";
  return outcomeLabel(status) || "Case";
}

function statusPill(status) {
  const s = String(status || "").toUpperCase();
  if (s === "APPROVED") return "approved";
  if (s === "REJECTED" || s === "PROCESSING_ERROR") return "rejected";
  if (["NEEDS_REVIEW", "PENDING_APPROVAL", "IN_REVIEW", "READY_FOR_APPROVAL", "RETURNED"].includes(s)) {
    return "review";
  }
  if (["PROCESSING", "QUEUED", "UPLOADED", "RECEIVED"].includes(s)) return "working";
  return "working";
}
