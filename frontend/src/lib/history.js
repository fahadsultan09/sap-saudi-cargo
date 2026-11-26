import { EVENT_TITLES } from "./constants";
import { formatDateTime, outcomeLabel } from "./pipeline";

function eventType(raw) {
  return String(raw?.event_type || raw?.type || raw?.action || "").toUpperCase();
}

function eventTitle(evt) {
  const type = eventType(evt);
  if (EVENT_TITLES[type]) return EVENT_TITLES[type];
  if (type) return type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return "Event";
}

function eventDescription(evt) {
  const parts = [];
  if (evt.reason) parts.push(evt.reason);
  const after = evt.after || evt.payload?.after || evt.payload || {};
  const status = after.status || after.to || evt.payload?.status;
  if (status) parts.push(`Status: ${outcomeLabel(status)}`);
  if (evt.comment) parts.push(evt.comment);
  if (eventType(evt) === "FIELDS_CORRECTED" || eventType(evt) === "FIELD_UPDATE") {
    const changed = after.fields || after;
    if (changed && typeof changed === "object" && !Array.isArray(changed)) {
      Object.keys(changed)
        .filter((k) => !["status"].includes(k))
        .slice(0, 4)
        .forEach((k) => parts.push(`${k.replace(/_/g, " ")} updated`));
    }
  }
  return parts.filter(Boolean).join(" · ") || "Recorded on this case";
}

function eventTone(type) {
  if (/APPROV|ACCEPT|PASS/.test(type)) return "ok";
  if (/REJECT|FAIL|ERROR/.test(type)) return "err";
  if (/RETURN|CORRECT|DUPLICATE|WARN/.test(type)) return "warn";
  return "info";
}

/**
 * Normalize agentic `{events, decisions}` or AP Core `{items}` into a timeline.
 */
export function mapAuditTrail(history) {
  if (!history) return [];
  const items = [];

  const events = history.events || history.items || [];
  events.forEach((evt, i) => {
    const type = eventType(evt);
    items.push({
      id: `e-${evt.id || i}-${type}`,
      at: evt.created_at || evt.timestamp || "",
      title: eventTitle(evt),
      description: eventDescription(evt),
      meta: [evt.actor || evt.user_id || evt.created_by, formatDateTime(evt.created_at || evt.timestamp)]
        .filter(Boolean)
        .join(" · "),
      tone: eventTone(type),
      sortAt: evt.created_at || evt.timestamp || "",
    });
  });

  (history.decisions || []).forEach((d, i) => {
    const action = String(d.action || d.decision || "").toUpperCase();
    const type =
      action === "APPROVE" || action === "APPROVED"
        ? "APPROVAL_APPROVED"
        : action === "RETURN" || action === "RETURNED"
          ? "APPROVAL_RETURNED"
          : action === "REJECT" || action === "REJECTED"
            ? "APPROVAL_REJECTED"
            : action || "DECISION";
    items.push({
      id: `d-${d.id || i}-${type}`,
      at: d.created_at || "",
      title: EVENT_TITLES[type] || "Decision",
      description: d.comment || d.reason || action || "Decision recorded",
      meta: [d.actor || d.decided_by || d.user_id, formatDateTime(d.created_at)]
        .filter(Boolean)
        .join(" · "),
      tone: eventTone(type),
      sortAt: d.created_at || "",
    });
  });

  return items.sort((a, b) => String(b.sortAt).localeCompare(String(a.sortAt)));
}
