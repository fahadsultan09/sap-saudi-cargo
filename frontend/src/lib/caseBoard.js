import { CASE_GROUPS, CASES_PER_PAGE } from "./constants";
import { formatAmount, formatDate, outcomeLabel } from "./pipeline";

export function countByStatuses(cases, statuses) {
  const set = new Set(statuses);
  return (cases || []).filter((c) => set.has(c.status)).length;
}

export function buildKpis(cases) {
  const list = cases || [];
  return [
    { key: "total", label: "Total invoices", value: list.length, tone: "brand" },
    ...CASE_GROUPS.map((g) => ({
      key: g.key,
      label: g.label,
      value: countByStatuses(list, g.statuses),
      tone: g.tone,
    })),
  ];
}

export function filterCases(cases, filterKey) {
  const list = cases || [];
  if (!filterKey) return list;
  const group = CASE_GROUPS.find((g) => g.key === filterKey);
  if (!group) return list;
  const set = new Set(group.statuses);
  return list.filter((c) => set.has(c.status));
}

export function sortCases(cases) {
  return [...(cases || [])].sort((a, b) =>
    String(b.updated_at || b.created_at || "").localeCompare(
      String(a.updated_at || a.created_at || ""),
    ),
  );
}

export function paginate(cases, pageIndex, pageSize = CASES_PER_PAGE) {
  const list = cases || [];
  const count = Math.max(1, Math.ceil(list.length / pageSize) || 1);
  const index = Math.min(Math.max(pageIndex, 0), count - 1);
  const from = index * pageSize;
  const page = list.slice(from, from + pageSize);
  const end = from + page.length;
  return {
    items: page,
    page: {
      index,
      count,
      text: list.length ? `Page ${index + 1} of ${count}` : "No pages",
      range: list.length
        ? `Showing ${from + 1}–${end} of ${list.length}`
        : "No invoices",
    },
  };
}

export function mapCaseRow(item) {
  return {
    id: item.id,
    title: item.invoice_number || item.file_name || "Invoice",
    supplier: item.supplier_name || "Supplier pending",
    amount: formatAmount(item),
    status: item.status,
    outcome: outcomeLabel(item.status),
    updated: formatDate(item.updated_at || item.created_at),
    raw: item,
  };
}

export function nextDecidable(cases, afterId, decidableStatuses) {
  const set = new Set(decidableStatuses);
  const queue = sortCases(cases).filter((c) => set.has(c.status) && c.id !== afterId);
  return queue[0] || null;
}
