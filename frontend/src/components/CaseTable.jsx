import { OUTCOME_TONE } from "../lib/constants";
import { mapCaseRow } from "../lib/caseBoard";

export default function CaseTable({
  cases = [],
  onSelect,
  emptyTitle = "Nothing in this view",
  emptyHint = "Try another filter or upload an invoice.",
  actionsForRow,
}) {
  if (!cases.length) {
    return (
      <div className="empty-note empty-note--rich">
        <strong>{emptyTitle}</strong>
        <span>{emptyHint}</span>
      </div>
    );
  }

  return (
    <div className="case-table-wrap">
      <table className="case-table">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Supplier</th>
            <th>Amount</th>
            <th>Updated</th>
            <th>Status</th>
            {actionsForRow ? <th>Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {cases.map((item) => {
            const row = mapCaseRow(item);
            const tone = OUTCOME_TONE[row.outcome] || "review";
            return (
              <tr key={row.id} className="case-table__row">
                <td>
                  <button
                    type="button"
                    className="case-table__link"
                    onClick={() => onSelect?.(item)}
                  >
                    <strong>{row.title}</strong>
                    <span className="muted">{String(row.id).slice(0, 8)}…</span>
                  </button>
                </td>
                <td>{row.supplier}</td>
                <td>{row.amount}</td>
                <td>{row.updated || "—"}</td>
                <td>
                  <span className={`pill pill-${tone}`}>{row.outcome}</span>
                </td>
                {actionsForRow ? <td className="case-table__actions">{actionsForRow(item)}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
