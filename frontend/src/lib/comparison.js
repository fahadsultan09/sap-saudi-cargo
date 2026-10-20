import { CHECK_LABELS, FIELDS, REVIEW_REASONS } from "./constants";
import { formatAmount, reviewReasons } from "./pipeline";

const RESULT_TONE = {
  MATCH: "ok",
  PASS: "ok",
  passed: "ok",
  MISMATCH: "err",
  FAIL: "err",
  failed: "err",
  DIFFER: "warn",
  NOT_COMPARED: "muted",
  NOT_FOUND: "warn",
  SKIPPED: "muted",
  not_checked: "muted",
};

function labelForCheck(key) {
  return (
    CHECK_LABELS[key] ||
    FIELDS.find((f) => f.key === key)?.label ||
    String(key || "").replace(/_/g, " ")
  );
}

function normalizeResult(raw) {
  const s = String(raw || "").toUpperCase();
  if (["MATCH", "PASS", "PASSED", "OK", "CLEAR", "NO_DUPLICATE", "VALID"].includes(s)) {
    return "MATCH";
  }
  if (["MISMATCH", "FAIL", "FAILED", "ERROR", "BLOCK"].includes(s)) return "MISMATCH";
  if (["DIFFER", "WARN", "WARNING", "REVIEW"].includes(s)) return "DIFFER";
  if (["NOT_FOUND", "MISSING"].includes(s)) return "NOT_FOUND";
  if (["NOT_COMPARED", "SKIPPED", "NOT_CHECKED", ""].includes(s)) return "NOT_COMPARED";
  return s || "NOT_COMPARED";
}

function resultLabel(result) {
  return (
    {
      MATCH: "Match",
      MISMATCH: "Differ",
      DIFFER: "Check",
      NOT_FOUND: "Not found",
      NOT_COMPARED: "Not compared",
    }[result] || result
  );
}

/**
 * Build invoice | SAP | result rows when source_verdict / matching data exists,
 * otherwise surface finance-check rows so the comparison surface always has content
 * when validation is present.
 */
export function mapComparisons(caseRow) {
  const validation = caseRow?.validation || {};
  const verdict = validation.source_verdict || {};
  const fromVerdict = Array.isArray(verdict.comparisons) ? verdict.comparisons : [];
  const fromChecks = Array.isArray(validation.source_checks) ? validation.source_checks : [];
  const matching = validation.verifier_matching || validation.matching || {};
  const matchRows = Array.isArray(matching.comparisons) ? matching.comparisons : [];

  const raw = [...fromVerdict, ...fromChecks, ...matchRows];
  if (raw.length) {
    return raw.map((row, i) => {
      const result = normalizeResult(row.result || row.status || row.match_status);
      return {
        id: `${row.check || row.field || "row"}-${i}`,
        field: labelForCheck(row.check || row.field || row.key),
        invoice: row.invoice != null && row.invoice !== "" ? String(row.invoice) : "—",
        sap: row.sap != null && row.sap !== "" ? String(row.sap) : "—",
        result,
        resultLabel: resultLabel(result),
        tone: RESULT_TONE[result] || "muted",
        differs: ["MISMATCH", "DIFFER", "NOT_FOUND"].includes(result),
      };
    });
  }

  // Fallback: finance rule checks as comparison-style rows (no SAP column yet).
  const checks = validation.checks || {};
  const keys = Object.keys(checks);
  if (!keys.length) return [];

  return keys.map((key) => {
    const result = normalizeResult(checks[key]);
    return {
      id: key,
      field: labelForCheck(key),
      invoice: invoiceValueForCheck(caseRow, key),
      sap: "—",
      result,
      resultLabel: resultLabel(result),
      tone: RESULT_TONE[result] || RESULT_TONE[checks[key]] || "muted",
      differs: ["MISMATCH", "DIFFER", "NOT_FOUND"].includes(result),
      fromChecks: true,
    };
  });
}

function invoiceValueForCheck(caseRow, key) {
  if (key === "vendor") return caseRow?.supplier_name || caseRow?.supplier_id || "—";
  if (key === "po") return caseRow?.po_number || "—";
  if (key === "tax") return caseRow?.currency ? `${caseRow.currency}` : "—";
  if (key === "duplicate") {
    const dups = caseRow?.validation?.possible_duplicates || [];
    return dups.length ? `${dups.length} similar` : "None found";
  }
  return "—";
}

export function mapVerdict(caseRow) {
  const validation = caseRow?.validation || {};
  const verdict = validation.source_verdict || {};
  const comparisons = mapComparisons(caseRow);
  const matches = comparisons.filter((r) => r.result === "MATCH").length;
  const differs = comparisons.filter((r) => r.differs).length;
  const reasons = reviewReasons(caseRow);
  const blocking = validation.blocking || [];
  const missing = validation.missing_fields || [];

  let headline = "Ready for your review";
  let canPay = null;
  let tone = "review";

  if (verdict.status === "MATCH" || verdict.status === "PASS") {
    headline = verdict.summary || "Invoice details match SAP.";
    canPay = true;
    tone = "approved";
  } else if (verdict.status === "MISMATCH" || verdict.status === "FAIL") {
    headline = verdict.summary || "Invoice does not fully match SAP.";
    canPay = false;
    tone = "rejected";
  } else if (verdict.status === "NOT_FOUND") {
    headline = verdict.summary || "No matching purchase order found in SAP.";
    canPay = false;
    tone = "review";
  } else if (caseRow?.status === "APPROVED") {
    headline = "Approved — ready for posting when integration is available.";
    canPay = true;
    tone = "approved";
  } else if (caseRow?.status === "REJECTED") {
    headline = "Rejected — will not proceed.";
    canPay = false;
    tone = "rejected";
  } else if (reasons.length) {
    headline = reasons[0];
    canPay = false;
    tone = "review";
  } else if (missing.length) {
    headline = `Missing required fields: ${missing.join(", ")}`;
    canPay = false;
  } else if (blocking.length) {
    headline = "Open checks need a human look before approval.";
    canPay = false;
  } else if (comparisons.length && differs === 0 && matches > 0) {
    headline = `All ${matches} checks look clear.`;
    canPay = true;
    tone = "approved";
  }

  const points = [];
  if (comparisons.length) {
    points.push(
      differs
        ? `${matches} match · ${differs} need a look · ${comparisons.length - matches - differs} not compared`
        : `${matches} of ${comparisons.length} checks match`,
    );
  }
  if (caseRow?.po_number) points.push(`PO ${caseRow.po_number}`);
  if (caseRow?.total_amount != null && caseRow.total_amount !== "") {
    points.push(formatAmount(caseRow));
  }
  reasons.slice(0, 3).forEach((r) => {
    if (r !== headline) points.push(r);
  });

  return {
    hasData: Boolean(
      comparisons.length ||
        reasons.length ||
        missing.length ||
        blocking.length ||
        verdict.status ||
        caseRow?.review_reason,
    ),
    headline,
    canPay,
    tone,
    points,
    status: verdict.status || caseRow?.status || "",
    summary: verdict.summary || caseRow?.review_reason || "",
  };
}

export function mapIssues(caseRow) {
  const validation = caseRow?.validation || {};
  const rows = [];
  const missing = validation.missing_fields || [];
  if (missing.length) {
    rows.push({
      area: "Invoice details",
      title: "Required fields missing",
      detail: missing.map(labelForCheck).join(", "),
    });
  }
  const codes = validation.review_decision?.reason_codes || [];
  codes.forEach((code, i) => {
    if (code === "MISSING_REQUIRED_FIELDS") return;
    rows.push({
      area: "Review",
      title: REVIEW_REASONS[code] || validation.review_decision?.reasons?.[i] || code,
      detail: "",
    });
  });
  const dups = validation.possible_duplicates || validation.business_duplicate;
  if (Array.isArray(dups) && dups.length) {
    rows.push({
      area: "Duplicates",
      title: "Possible duplicate file",
      detail: `${dups.length} earlier case${dups.length === 1 ? "" : "s"} share this file fingerprint.`,
    });
  } else if (dups && typeof dups === "object") {
    rows.push({
      area: "Duplicates",
      title: "Possible duplicate invoice",
      detail: "Another invoice has the same number, supplier, or fingerprint.",
    });
  }
  mapComparisons(caseRow)
    .filter((r) => r.differs)
    .forEach((r) => {
      rows.push({
        area: "SAP comparison",
        title: `${r.field} differs`,
        detail: `Invoice: ${r.invoice} · SAP: ${r.sap}`,
      });
    });
  return { count: rows.length, rows };
}

export function hasSapComparisonData(caseRow) {
  const v = caseRow?.validation || {};
  return Boolean(
    (v.source_verdict && (v.source_verdict.comparisons?.length || v.source_verdict.status)) ||
      (Array.isArray(v.source_checks) && v.source_checks.length) ||
      v.verifier_matching ||
      v.matching,
  );
}

/** Earlier cases that share a file fingerprint (for actionable duplicate UI). */
export function mapDuplicateCases(caseRow) {
  const raw = caseRow?.validation?.possible_duplicates;
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw
    .map((d) => {
      if (!d) return null;
      if (typeof d === "string") return { id: d, status: "" };
      const id = d.id || d.case_id;
      if (!id) return null;
      return { id, status: d.status || "" };
    })
    .filter(Boolean);
}
