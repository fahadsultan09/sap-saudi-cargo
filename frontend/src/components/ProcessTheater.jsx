import { AnimatePresence, motion } from "framer-motion";
import { pipelineProgress } from "../lib/pipeline";

const ease = [0.22, 1, 0.36, 1];

function ThinkingDots() {
  return (
    <span className="thinking-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function AgentNode({ step, index, compact }) {
  const state = step.state || "pending";
  const statusLabel =
    state === "running"
      ? "Working"
      : state === "done"
        ? "Done"
        : state === "failed"
          ? "Stopped"
          : "Waiting";

  return (
    <motion.article
      className={`agent-node${compact ? " agent-node--compact" : ""}`}
      data-state={state}
      initial={{ opacity: 0, y: 18, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.07, duration: 0.55, ease }}
      layout
    >
      <div className="agent-node__orb" aria-hidden="true">
        <span className="agent-node__glyph">{step.glyph || "●"}</span>
        {state === "running" ? <span className="agent-node__ring" /> : null}
        {state === "running" ? <span className="agent-node__shimmer" /> : null}
        {state === "done" ? <span className="agent-node__check">✓</span> : null}
      </div>

      <div className="agent-node__body">
        <div className="agent-node__titles">
          <h4>{step.title}</h4>
        </div>
        {!compact ? <p className="agent-node__desc">{step.description}</p> : null}
        <div className="agent-node__meta">
          <span className={`agent-status agent-status--${state}`}>
            {state === "running" ? <ThinkingDots /> : null}
            {statusLabel}
          </span>
          {step.role ? <span className="agent-role">{step.role}</span> : null}
        </div>
      </div>
    </motion.article>
  );
}

function Connector({ filled, active, index }) {
  return (
    <div className="theater-connector" aria-hidden="true">
      <motion.div
        className="theater-connector__track"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: 0.15 + index * 0.08, duration: 0.45, ease }}
      >
        <motion.span
          className="theater-connector__fill"
          initial={false}
          animate={{
            scaleX: filled ? 1 : active ? 0.55 : 0,
            opacity: filled || active ? 1 : 0.35,
          }}
          transition={{ duration: 0.65, ease }}
        />
        {active ? <span className="theater-connector__pulse" /> : null}
      </motion.div>
    </div>
  );
}

export default function ProcessTheater({
  steps,
  title = "Working on your invoice",
  subtitle,
  variant = "full",
}) {
  const progress = pipelineProgress(steps);
  const compact = variant === "compact" || variant === "mini";
  const mini = variant === "mini";

  return (
    <section
      className={`theater theater--${variant}${progress.percent >= 100 ? " theater--complete" : ""}`}
      aria-live="polite"
    >
      <div className="theater-atmosphere" aria-hidden="true">
        <span className="theater-glow theater-glow--a" />
        <span className="theater-glow theater-glow--b" />
        <span className="theater-grid" />
      </div>

      <div className="theater-head">
        <div>
          <p className="section-label">{title}</p>
          <AnimatePresence mode="wait">
            <motion.strong
              key={progress.nowText}
              className="theater-now-text"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35, ease }}
            >
              {progress.nowText}
            </motion.strong>
          </AnimatePresence>
          {subtitle ? <p className="theater-sub">{subtitle}</p> : null}
        </div>

        <div className="theater-meter">
          <span className="pill pill-working">
            {progress.doneCount}/{progress.total}
          </span>
          <div className="progress" aria-hidden="true">
            <motion.span
              initial={false}
              animate={{ width: `${progress.percent}%` }}
              transition={{ duration: 0.55, ease }}
            />
          </div>
        </div>
      </div>

      <div className={`theater-runway${mini ? " theater-runway--mini" : ""}`}>
        {steps.map((step, index) => {
          const prevDone = index === 0 || steps[index - 1]?.state === "done";
          const filled = step.state === "done" || (step.state === "running" && prevDone);
          const connectorFilled = index > 0 && steps[index - 1]?.state === "done";
          const connectorActive = index > 0 && steps[index - 1]?.state === "running";

          return (
            <div key={step.key} className="theater-slot">
              {index > 0 ? (
                <Connector filled={connectorFilled || filled} active={connectorActive} index={index} />
              ) : null}
              <AgentNode step={step} index={index} compact={compact} />
            </div>
          );
        })}
      </div>

      {!mini && progress.percent >= 100 ? (
        <motion.div
          className="theater-celebrate"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease }}
        >
          All set — ready for you
        </motion.div>
      ) : null}
    </section>
  );
}
