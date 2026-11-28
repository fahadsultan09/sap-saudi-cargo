import React, { useEffect, useMemo, useState } from "react";
import {
  APPROVED,
  NEEDS_ATTENTION,
  OUTCOME_TONE,
  PROCESSING,
} from "../lib/constants";
import { formatAmount, formatDate, outcomeLabel } from "../lib/pipeline";
import DetailSheet from "./DetailSheet";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "review", label: "Needs review" },
  { id: "working", label: "Working" },
  { id: "done", label: "Done" },
];

function matchesFilter(item, filter) {
  if (filter === "review") return NEEDS_ATTENTION.includes(item.status);
  if (filter === "working") return PROCESSING.includes(item.status);
  if (filter === "done") {
    return APPROVED.includes(item.status) || item.status === "REJECTED";
  }
  return true;
}

export default function InvoiceHistorySheet({
  open,
  cases = [],
  onClose,
  onSelect,
  initialFilter = "all",
  title = "Invoices",
}) {
  const [filter, setFilter] = useState(initialFilter);

  useEffect(() => {
    if (open) setFilter(initialFilter || "all");
  }, [open, initialFilter]);

  const sorted = useMemo(
    () =>
      [...cases].sort((a, b) =>
        String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)),
      ),
    [cases],
  );

  const filtered = useMemo(
    () => sorted.filter((item) => matchesFilter(item, filter)),
    [sorted, filter],
  );

  const counts = useMemo(
    () => ({
      all: sorted.length,
      review: sorted.filter((c) => NEEDS_ATTENTION.includes(c.status)).length,
      working: sorted.filter((c) => PROCESSING.includes(c.status)).length,
      done: sorted.filter(
        (c) => APPROVED.includes(c.status) || c.status === "REJECTED",
      ).length,
    }),
    [sorted],
  );

  return (
    <DetailSheet
      open={open}
      onClose={onClose}
      title={title}
      eyebrow="History"
      glyph="☰"
      wide
      labelledBy="invoice-history-title"
    >
      <div className="history-filters" role="tablist" aria-label="Filter invoices">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`history-filter${filter === f.id ? " history-filter--active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <span className="history-filter__count">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-note empty-note--rich" style={{ marginTop: "0.5rem" }}>
          <strong>Nothing in this view</strong>
          <span>
            {sorted.length === 0
              ? "Upload an invoice to start a case."
              : "Try another filter — or upload a new invoice."}
          </span>
        </div>
      ) : (
        <ul className="history-list">
          {filtered.map((item) => {
            const outcome = outcomeLabel(item.status);
            const tone = OUTCOME_TONE[outcome] || "review";
            const itemTitle = item.invoice_number || item.file_name || "Invoice";
            const itemSupplier = item.supplier_name || "Supplier pending";
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="history-row"
                  onClick={() => {
                    onSelect?.(item);
                    onClose?.();
                  }}
                >
                  <div className="history-row__main">
                    <strong>{itemTitle}</strong>
                    <span>
                      {itemSupplier} · {formatAmount(item)}
                    </span>
                    <span className="history-row__meta">
                      {formatDate(item.updated_at || item.created_at)}
                      {item.id ? ` · ${String(item.id).slice(0, 8)}…` : ""}
                    </span>
                  </div>
                  <span className={`pill pill-${tone}`}>{outcome}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </DetailSheet>
  );
}
