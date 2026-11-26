import { FIELDS } from "./constants";

/** Normalise 0–1 or 0–100 scores to a 0–100 integer percent, or null. */
export function toPercent(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n >= 0 && n <= 1) return Math.round(n * 100);
  if (n > 1 && n <= 100) return Math.round(n);
  return null;
}

function fieldLabel(key) {
  return FIELDS.find((f) => f.key === key)?.label || String(key).replace(/_/g, " ");
}

/**
 * Derive extraction confidence from a case row.
 * Primary: validation.confidence (overall / avg of required fields from triage).
 * Also surfaces classification confidence and per-field scores when present.
 */
export function extractionConfidence(caseRow) {
  const validation = caseRow?.validation || {};
  const tower = (validation.agent_trace || []).find((s) => s?.agent === "TOWER");
  const classificationRaw =
    validation.ai_core?.confidence ??
    validation.review_decision?.confidence ??
    tower?.details?.confidence ??
    null;

  const fieldMap =
    validation.field_confidences ||
    validation.field_confidence ||
    caseRow?.field_confidences ||
    null;

  const fields = [];
  if (fieldMap && typeof fieldMap === "object" && !Array.isArray(fieldMap)) {
    Object.entries(fieldMap).forEach(([key, raw]) => {
      const percent = toPercent(raw);
      if (percent == null) return;
      fields.push({ key, label: fieldLabel(key), percent });
    });
    fields.sort((a, b) => a.label.localeCompare(b.label));
  }

  let overall = toPercent(validation.confidence);
  let source = overall != null ? "overall" : null;

  if (overall == null && fields.length) {
    overall = Math.round(fields.reduce((sum, f) => sum + f.percent, 0) / fields.length);
    source = "average";
  }

  const classification = toPercent(classificationRaw);

  if (overall == null && classification != null) {
    overall = classification;
    source = "classification";
  }

  return {
    overall,
    source,
    classification,
    fields,
    hasAny: overall != null || classification != null || fields.length > 0,
  };
}

export function confidenceLabel(source) {
  if (source === "average") return "Average across extracted fields";
  if (source === "classification") return "Document type confidence";
  return "Overall extraction confidence";
}
