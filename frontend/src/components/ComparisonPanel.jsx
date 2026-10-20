import { Link } from "react-router-dom";
import {
  hasSapComparisonData,
  mapComparisons,
  mapDuplicateCases,
  mapIssues,
  mapVerdict,
} from "../lib/comparison";
import { outcomeLabel } from "../lib/pipeline";

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

  if (!verdict.hasData && !comparisons.length && !duplicates.length) {
    return (
      <div className="empty-note empty-note--rich">
        <strong>No comparison yet</strong>
        <span>
          When SAP match data is on the case, invoice vs SAP rows appear here. Finance checks and
          review flags still show in Summary.
        </span>
        {onGoFields ? (
          <div className="comparison-panel__actions">
            <button type="button" className="btn btn-primary btn-compact" onClick={onGoFields}>
              Check extracted fields
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`comparison-panel${compact ? " comparison-panel--compact" : ""}`}>
      <section className={`verdict-card verdict-card--${verdict.tone}`}>
        <p className="section-label">Summary</p>
        <h3>{verdict.headline}</h3>
        {verdict.canPay != null ? (
          <p className="muted">
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
            Showing finance checks — full SAP field comparison appears when the gateway attaches
            source verdict data.
          </p>
        ) : null}
      </section>

      {issues.count > 0 ? (
        <section className="issues-block">
          <h4>Issues ({issues.count})</h4>
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
          <h4>Earlier cases ({duplicates.length})</h4>
          <p className="muted comparison-panel__hint" style={{ marginTop: 0 }}>
            Open a prior case to compare status before you approve or re-process this file.
          </p>
          <ul className="dup-cases-list">
            {duplicates.map((d) => (
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
        </section>
      ) : null}

      {comparisons.length ? (
        <section className="compare-table-wrap">
          <h4>{sapLive && !financeOnly ? "Invoice vs SAP" : "Checks"}</h4>
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
        <section className="empty-note empty-note--rich comparison-panel__sap-empty">
          <strong>No invoice vs SAP rows on this case</strong>
          <span>
            {duplicates.length
              ? "Duplicate fingerprint is the main flag here — SAP field matching was not attached. Use the earlier cases above, then confirm fields on the PDF."
              : "SAP field matching is not attached yet. Confirm extracted fields against the PDF, then record a decision when ready."}
          </span>
        </section>
      )}

      {!compact ? (
        <section className="comparison-panel__next" aria-label="What to do next">
          <p className="section-label">What to do next</p>
          <div className="comparison-panel__actions">
            {onGoFields ? (
              <button type="button" className="btn btn-primary btn-compact" onClick={onGoFields}>
                Check extracted fields
              </button>
            ) : null}
            {canDecide ? (
              <span className="muted comparison-panel__next-hint">
                Ready? Use Approve / Send back / Reject in the bar below.
              </span>
            ) : canEdit ? (
              <span className="muted comparison-panel__next-hint">
                Save field corrections, then switch role to Approver to decide.
              </span>
            ) : (
              <span className="muted comparison-panel__next-hint">
                Switch to Processor or Approver if you need to edit or decide.
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
