import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AGENT_ACTIONS, PROCESS_STEPS } from "../lib/constants";

function statusCopy(state) {
  if (state === "running") return { label: "Working now", tone: "running" };
  if (state === "done") return { label: "Complete", tone: "done" };
  if (state === "failed") return { label: "Needs attention", tone: "failed" };
  return { label: "Standing by", tone: "pending" };
}

export default function StageDetailSheet({ step, onClose, actions = null }) {
  const def = PROCESS_STEPS.find((s) => s.key === step?.key) || {};
  const live = step || {};
  const state = live.state || "pending";
  const status = statusCopy(state);
  const plainActions = AGENT_ACTIONS[def.key] || [];
  const title = live.title || def.title || "Stage";
  const detail = def.detail || live.description || def.plain || "";
  const does = def.does || [];
  const outcome =
    state === "done" || state === "failed"
      ? live.outcome || def.outcome
      : def.outcome;
  const currentLine =
    state === "running"
      ? live.description || plainActions[0] || def.plain
      : state === "pending"
        ? def.plain
        : outcome;

  useEffect(() => {
    if (!step) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, onClose]);

  return (
    <AnimatePresence>
      {step ? (
        <div key={step.key || "stage"} className="stage-sheet" role="presentation">
          <motion.button
            type="button"
            className="stage-sheet__backdrop"
            aria-label="Close stage details"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.aside
            className="stage-sheet__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stage-sheet-title"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
          >
            <header className="stage-sheet__head">
              <div className="stage-sheet__orb" aria-hidden="true">
                <span>{def.glyph || live.glyph || "●"}</span>
              </div>
              <div className="stage-sheet__titles">
                <p className="section-label">{def.role || "Stage"}</p>
                <h2 id="stage-sheet-title">{title}</h2>
              </div>
              <button type="button" className="stage-sheet__close" onClick={onClose} aria-label="Close">
                ×
              </button>
            </header>

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
                </dl>
              </details>
            )}

            {actions ? <div className="stage-sheet__actions btn-row">{actions}</div> : null}
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
