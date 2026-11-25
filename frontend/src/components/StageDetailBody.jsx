import React from "react";
import { AGENT_ACTIONS, PROCESS_STEPS } from "../lib/constants";

export function statusCopy(state) {
  if (state === "running") return { label: "WORKING", tone: "running" };
  if (state === "awaiting") return { label: "YOUR TURN", tone: "awaiting" };
  if (state === "done") return { label: "Done", tone: "done" };
  if (state === "failed") return { label: "Needs attention", tone: "failed" };
  return { label: "Standing by", tone: "pending" };
}

/** Shared stage explanation used by Home sheet and Process side pane. */
export default function StageDetailBody({ step }) {
  const def = PROCESS_STEPS.find((s) => s.key === step?.key) || {};
  const live = step || {};
  const state = live.state || "pending";
  const status = statusCopy(state);
  const plainActions = AGENT_ACTIONS[def.key] || [];
  const detail = def.detail || live.description || def.plain || "";
  const does = def.does || [];
  const outcome =
    state === "done" || state === "failed" ? live.outcome || def.outcome : def.outcome;
  const currentLine =
    state === "running"
      ? live.description || plainActions[0] || def.plain
      : state === "awaiting"
        ? live.description || plainActions[0] || "Handing off to you…"
        : state === "pending"
          ? def.plain
          : outcome;

  return (
    <>
      <div className="stage-sheet__status">
        <span className={`agent-status agent-status--${status.tone}`}>{status.label}</span>
        {currentLine ? <p className="stage-sheet__now">{currentLine}</p> : null}
      </div>

      <section className="stage-sheet__block">
        <h3>What this stage does</h3>
        <p>{detail}</p>
        {does.length ? (
          <ul className="stage-sheet__list">
            {does.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {outcome ? (
        <section className="stage-sheet__block">
          <h3>Outcome</h3>
          <p>{outcome}</p>
        </section>
      ) : null}

      {(def.agent || def.codename) && (
        <details className="stage-sheet__tech">
          <summary>Technical details</summary>
          <dl>
            {def.codename ? (
              <>
                <dt>Codename</dt>
                <dd>{def.codename}</dd>
              </>
            ) : null}
            {def.agent ? (
              <>
                <dt>Agent id</dt>
                <dd>
                  <code>{def.agent}</code>
                </dd>
              </>
            ) : null}
            {def.role ? (
              <>
                <dt>Role</dt>
                <dd>{def.role}</dd>
              </>
            ) : null}
            {live.detailMeta ? (
              <>
                <dt>Duration</dt>
                <dd>{live.detailMeta}</dd>
              </>
            ) : null}
          </dl>
        </details>
      )}
    </>
  );
}
