import {
  AGENT_ACTIONS,
  APPROVED,
  DECIDABLE,
  EDITABLE,
  FIELDS,
  NEEDS_ATTENTION,
  NOW_LABELS,
  PROCESS_STEPS,
  PROCESSING,
  REVIEW_REASONS,
  STATUS_PLAIN,
} from "./constants";

function agentIndex(agent) {
  const order = ["TOWER", "LENS", "FINANCE_RULES"];
  const i = order.indexOf(agent);
  return i < 0 ? order.length : i;
}

function traceState(status) {
  const s = String(status || "").toLowerCase();
  if (["completed", "skipped", "done"].includes(s)) return "done";
  if (["failed", "error"].includes(s)) return "failed";
  if (["running", "in_progress", "processing"].includes(s)) return "running";
  return "pending";
}

function inferRunningAgent(byAgent, processing) {
  if (!processing) return null;
  for (const agent of ["TOWER", "LENS", "FINANCE_RULES"]) {
    const step = byAgent[agent];
    if (!step) return agent;
    const state = traceState(step.status);
    if (state === "running" || state === "failed" || state !== "done") return agent;
  }
  return "FINANCE_RULES";
}

export function buildPipeline(caseRow) {
  const validation = caseRow?.validation || {};
  const trace = validation.agent_trace || [];
  const byAgent = {};
  trace.forEach((step) => {
    byAgent[step.agent] = step;
  });

  const status = caseRow?.status;
  const processing = PROCESSING.includes(status);
  const error = status === "PROCESSING_ERROR";
  const needsHuman = NEEDS_ATTENTION.includes(status);
  const approved = APPROVED.includes(status);
  const rejected = status === "REJECTED";
  const pastAgents = needsHuman || approved || rejected || error;
  const runningAgent = inferRunningAgent(byAgent, processing);

  return PROCESS_STEPS.map((def) => {
    const oTrace = def.agent ? byAgent[def.agent] : null;
    const actions = AGENT_ACTIONS[def.key] || [def.plain];
    let state = "pending";
    let description = def.plain;
    let outcome = def.outcome || `${def.plain} — done`;

    if (def.key === "receive") {
      state = "done";
      outcome = caseRow?.file_name
        ? `Received “${caseRow.file_name}”`
        : def.outcome;
      description = outcome;
    } else if (def.key === "decide") {
      if (approved) {
        state = "done";
        outcome = "Approved";
        description = outcome;
      } else if (rejected) {
        state = "failed";
        outcome = "Rejected";
        description = outcome;
      } else if (needsHuman) {
        state = "awaiting";
        description = actions[0] || "Handing off to you…";
        outcome = def.outcome;
      } else if (error) {
        state = "pending";
        description = "Fix details, then decide";
      }
    } else if (oTrace) {
      state = traceState(oTrace.status);
      if (oTrace.summary) {
        outcome = oTrace.summary;
        description = oTrace.summary;
      } else if (state === "done") {
        description = outcome;
      }
    } else if (pastAgents && !error) {
      state = "done";
      description = outcome;
    } else if (error) {
      if (!trace.length && def.agent === "TOWER") {
        state = "failed";
        description = "Automatic reading stopped";
        outcome = description;
      } else if (runningAgent === def.agent) {
        state = "failed";
      } else if (agentIndex(def.agent) < agentIndex(runningAgent)) {
        state = "done";
        description = outcome;
      }
    } else if (processing && def.agent && def.agent === runningAgent) {
      state = "running";
    } else if (processing && def.agent && agentIndex(def.agent) < agentIndex(runningAgent)) {
      state = "done";
      description = outcome;
    } else if (processing && status === "RECEIVED" && def.agent === "TOWER") {
      state = "running";
    }

    let nowLabel = "";
    if (state === "running") {
      nowLabel = actions[0] || NOW_LABELS[def.key] || def.title;
      if (!oTrace?.summary) description = nowLabel;
    } else if (state === "awaiting") {
      nowLabel = NOW_LABELS[def.key] || actions[0] || "Ready for you…";
    }

    return {
      key: def.key,
      title: def.title,
      description,
      outcome,
      actions,
      nowLabel,
      state,
      agent: def.agent || "",
      codename: def.codename || "",
      role: def.role || "",
      glyph: def.glyph || "●",
      // Advanced detail only — never shown on main theater
      detailMeta: oTrace?.duration_ms != null ? `${oTrace.duration_ms} ms` : "",
      detailAgent: def.agent || "",
      detailSummary: oTrace?.summary || "",
      detailStatus: oTrace?.status || "",
    };
  });
}

export function pipelineProgress(steps) {
  const list = steps || [];
  const done = list.filter((s) => s.state === "done").length;
  const running = list.find((s) => s.state === "running");
  const awaiting = list.find((s) => s.state === "awaiting");
  const active = running || awaiting;
  const total = Math.max(list.length, 1);
  const score = done + (running ? 0.45 : awaiting ? 0.9 : 0);
  const percent = Math.max(0, Math.min(100, Math.round((score / total) * 100)));
  let nowText = "Standing by";
  if (active) {
    nowText = active.nowLabel || active.title;
  } else if (done >= total) {
    nowText = "Ready for you";
  }
  return { percent, nowText, doneCount: done, total, runningKey: active?.key || "" };
}

export function outcomeLabel(status) {
  return STATUS_PLAIN[status] || status || "—";
}

export function formatAmount(caseRow) {
  const n = Number(caseRow?.total_amount);
  if (caseRow?.total_amount == null || caseRow?.total_amount === "" || Number.isNaN(n)) {
    return "—";
  }
  return (
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
    (caseRow.currency ? ` ${caseRow.currency}` : "")
  );
}

export function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Riyadh",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function mapFields(caseRow) {
  const missing = caseRow?.validation?.missing_fields || [];
  const fieldMap =
    caseRow?.validation?.field_confidences ||
    caseRow?.validation?.field_confidence ||
    caseRow?.field_confidences ||
    null;
  return FIELDS.map((f) => {
    const value = caseRow?.[f.key] == null ? "" : String(caseRow[f.key]);
    let confidence = null;
    if (fieldMap && typeof fieldMap === "object" && fieldMap[f.key] != null) {
      const n = Number(fieldMap[f.key]);
      if (Number.isFinite(n)) {
        confidence = n >= 0 && n <= 1 ? Math.round(n * 100) : Math.round(n);
      }
    }
    return {
      key: f.key,
      label: f.label,
      value,
      original: value,
      required: Boolean(f.required),
      confidence,
      needsAttention: (f.required && !value) || missing.includes(f.key),
      sourceHint: missing.includes(f.key)
        ? "Marked missing by finance checks"
        : f.required
          ? "Required field from the PDF"
          : "Optional field from the PDF",
    };
  });
}

/** Longer timestamps for case detail sheets. */
export function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Riyadh",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

export function reviewReasons(caseRow) {
  const validation = caseRow?.validation || {};
  const codes = validation.review_decision?.reason_codes || [];
  if (!codes.length) {
    return caseRow?.review_reason ? [caseRow.review_reason] : [];
  }
  const texts = validation.review_decision?.reasons || [];
  return codes.map((code, i) => REVIEW_REASONS[code] || texts[i] || code);
}

export function permissionsFor(caseRow, canProcessRole, canApproveRole) {
  const status = caseRow?.status;
  return {
    canEdit: canProcessRole && EDITABLE.includes(status),
    canDecide: canApproveRole && DECIDABLE.includes(status),
    isProcessing: PROCESSING.includes(status),
  };
}
