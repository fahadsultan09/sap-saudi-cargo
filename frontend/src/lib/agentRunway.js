import { AGENT_ACTIONS, PROCESS_STEPS } from "./constants";

/** Build a full step snapshot for a given active index (for fast backends). */
export function stepsAtIndex(activeIndex, fileName = "") {
  return PROCESS_STEPS.map((s, i) => {
    const actions = AGENT_ACTIONS[s.key] || [s.plain];
    let state = "pending";
    let description = s.plain;
    let outcome = s.outcome || `${s.plain} — done`;
    let nowLabel = "";
    if (i < activeIndex) {
      state = "done";
      if (s.key === "receive" && fileName) {
        outcome = `Received “${fileName}”`;
      }
      description = outcome;
    } else if (i === activeIndex) {
      state = "running";
      nowLabel = actions[0] || `${s.title} working…`;
      description = nowLabel;
    }
    if (activeIndex >= PROCESS_STEPS.length) {
      state = s.key === "decide" ? "running" : "done";
      if (s.key === "decide") {
        nowLabel = actions[0] || "Ready for you…";
        description = "Ready for you to review";
        outcome = s.outcome || "Ready for your decision";
      } else {
        if (s.key === "receive" && fileName) outcome = `Received “${fileName}”`;
        description = outcome;
      }
    }
    return {
      key: s.key,
      title: s.title,
      description,
      outcome,
      actions,
      nowLabel,
      state,
      agent: s.agent || "",
      codename: s.codename || "",
      role: s.role || "",
      glyph: s.glyph || "●",
    };
  });
}

/**
 * Staggered agent runway when the API finishes before the theater can paint.
 * Calls onFrame(steps) for each beat, then resolves.
 */
export function playAgentRunway({ fileName, onFrame, minMs = 4800 } = {}) {
  const beats = PROCESS_STEPS.length;
  const perBeat = Math.max(560, Math.floor(minMs / (beats + 1)));
  let cancelled = false;
  const timers = [];

  const promise = new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      onFrame?.(stepsAtIndex(i, fileName));
      i += 1;
      if (i <= beats) {
        timers.push(setTimeout(tick, perBeat));
      } else {
        onFrame?.(stepsAtIndex(beats, fileName));
        timers.push(setTimeout(resolve, 480));
      }
    };
    tick();
  });

  return {
    promise,
    cancel() {
      cancelled = true;
      timers.forEach(clearTimeout);
    },
  };
}
