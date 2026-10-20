import { hasSapComparisonData, mapComparisons, mapIssues, mapVerdict } from "../lib/comparison";

export default function ComparisonPanel({ caseRow, compact = false }) {
  const comparisons = mapComparisons(caseRow);
  const verdict = mapVerdict(caseRow);
  const issues = mapIssues(caseRow);
  const sapLive = hasSapComparisonData(caseRow);

  if (!verdict.hasData && !comparisons.length) {
    return (
      <div className="empty-note empty-note--rich">
        <strong>No comparison yet</strong>
        <span>
          When SAP match data is on the case, invoice vs SAP rows appear here. Finance checks and
          review flags still show in Summary.
        </span>
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

      {comparisons.length ? (
        <section className="compare-table-wrap">
          <h4>{sapLive ? "Invoice vs SAP" : "Checks"}</h4>
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
                    <span className={`pill pill-${row.tone === "ok" ? "approved" : row.tone === "err" ? "rejected" : row.tone === "warn" ? "review" : "working"}`}>
                      {row.resultLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
