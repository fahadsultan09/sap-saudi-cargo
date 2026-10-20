import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { pipelineProgress } from "../lib/pipeline";

const ease = [0.22, 1, 0.36, 1];
const ACTION_ROTATE_MS = 1600;

function ThinkingDots() {
  return (
    <span className="thinking-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function useRotatingAction(actions, active) {
  const list = Array.isArray(actions) ? actions : [];
  const listKey = list.join("|");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (!active || list.length <= 1) return undefined;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % list.length);
    }, ACTION_ROTATE_MS);
    return () => clearInterval(timer);
  }, [active, listKey, list.length]);

  if (!list.length) return "";
  return list[Math.min(index, list.length - 1)];
}

function AgentNode({ step, index, compact, showTechnical, interactive, idle, onSelect }) {
  const state = step.state || "pending";
  const statusLabel =
    state === "running"
      ? "Working"
      : state === "awaiting"
        ? "Your turn"
        : state === "done"
          ? "Done"
          : state === "failed"
            ? "Stopped"
            : "Waiting";

  const actionLine = useRotatingAction(step.actions, state === "running");
  const line =
    state === "running"
      ? actionLine || step.description
      : state === "awaiting"
        ? step.description || actionLine || "Handing off to you…"
        : state === "done" || state === "failed"
          ? step.outcome || step.description
          : step.description || step.plain;

  const Tag = interactive ? motion.button : motion.article;
  const interactiveProps = interactive
    ? {
        type: "button",
        onClick: () => onSelect?.(step),
        "aria-label": `${step.title} — open stage details`,
      }
    : {};

  return (
    <Tag
      className={`agent-node${compact ? " agent-node--compact" : ""}${interactive ? " agent-node--interactive" : ""}${idle ? " agent-node--idle" : ""}`}
      data-state={state}
      style={idle ? { "--idle-delay": `${index * 0.28}s` } : undefined}
      initial={{ opacity: 0, y: 18, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.06, duration: 0.6, ease }}
      layout
      {...interactiveProps}
    >
      <div className="agent-node__orb" aria-hidden="true">
        <span className="agent-node__glyph">{step.glyph || "●"}</span>
        {state === "running" ? <span className="agent-node__ring" /> : null}
        {state === "running" ? <span className="agent-node__shimmer" /> : null}
        {state === "awaiting" ? <span className="agent-node__await" /> : null}
        {idle && state === "pending" ? <span className="agent-node__breath" /> : null}
        {state === "done" ? <span className="agent-node__check">✓</span> : null}
      </div>

      <div className="agent-node__body">
        <div className="agent-node__titles">
          <h4>{step.title}</h4>
        </div>

        <AnimatePresence mode="wait">
          <motion.p
            key={`${step.key}-${state}-${line}`}
            className={`agent-node__action${state === "running" || state === "awaiting" ? " agent-node__action--live" : ""}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.28, ease }}
          >
            {line}
          </motion.p>
        </AnimatePresence>

        <div className="agent-node__meta">
          <span className={`agent-status agent-status--${state}`}>
            {state === "running" ? <ThinkingDots /> : null}
            {statusLabel}
          </span>
          {showTechnical && step.agent ? (
            <span className="agent-role" title="Internal agent id">
              {step.agent}
            </span>
          ) : step.role && !compact ? (
            <span className="agent-role">{step.role}</span>
          ) : null}
          {interactive ? <span className="agent-node__hint">Details</span> : null}
        </div>
      </div>
    </Tag>
  );
}

function Connector({ filled, active, index, idle }) {
  return (
    <div className={`theater-connector${idle ? " theater-connector--idle" : ""}`} aria-hidden="true">
      <motion.div
        className="theater-connector__track"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: 0.15 + index * 0.08, duration: 0.45, ease }}
        style={idle ? { "--idle-delay": `${index * 0.35}s` } : undefined}
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
        {idle && !filled && !active ? <span className="theater-connector__idle-pulse" /> : null}
      </motion.div>
    </div>
  );
}

export default function ProcessTheater({
  steps,
  title = "Working on your invoice",
  subtitle,
  variant = "full",
  showTechnical = false,
  interactive = false,
  onStepSelect,
}) {
  const progress = pipelineProgress(steps);
  const compact = variant === "compact" || variant === "mini" || variant === "hero";
  const mini = variant === "mini";
  const hero = variant === "hero";
  const running = steps.find((s) => s.state === "running");
  const awaiting = steps.find((s) => s.state === "awaiting");
  const idle =
    !running &&
    !awaiting &&
    steps.length > 0 &&
    steps.every((s) => (s.state || "pending") === "pending");
  const liveAction = useRotatingAction(running?.actions, Boolean(running));
  const headline =
    running && liveAction
      ? liveAction
      : awaiting
        ? awaiting.nowLabel || awaiting.description || "Ready for you…"
        : idle
          ? "Standing by"
          : progress.nowText;

  return (
    <section
      className={`theater theater--${variant}${progress.percent >= 100 ? " theater--complete" : ""}${idle ? " theater--idle" : ""}${interactive ? " theater--interactive" : ""}`}
      aria-live="polite"
    >
      <div className="theater-atmosphere" aria-hidden="true">
        <span className="theater-glow theater-glow--a" />
        <span className="theater-glow theater-glow--b" />
        {idle ? <span className="theater-glow theater-glow--idle" /> : null}
        <span className="theater-grid" />
      </div>

      <div className="theater-head">
        <div>
          <p className="section-label">{title}</p>
          <AnimatePresence mode="wait">
            <motion.strong
              key={headline}
              className="theater-now-text"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35, ease }}
            >
              {headline}
            </motion.strong>
          </AnimatePresence>
          {subtitle ? <p className="theater-sub">{subtitle}</p> : null}
          {interactive && idle ? (
            <p className="theater-hint">Tap any stage for what it does</p>
          ) : null}
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

      <div className={`theater-runway${mini || hero ? " theater-runway--mini" : ""}${hero ? " theater-runway--hero" : ""}`}>
        {steps.map((step, index) => {
          const prevDone = index === 0 || steps[index - 1]?.state === "done";
          const filled =
            step.state === "done" ||
            ((step.state === "running" || step.state === "awaiting") && prevDone);
          const connectorFilled = index > 0 && steps[index - 1]?.state === "done";
          const connectorActive =
            index > 0 &&
            (steps[index - 1]?.state === "running" || steps[index - 1]?.state === "awaiting");

          return (
            <div key={step.key} className="theater-slot">
              {index > 0 ? (
                <Connector
                  filled={connectorFilled || filled}
                  active={connectorActive}
                  index={index}
                  idle={idle}
                />
              ) : null}
              <AgentNode
                step={step}
                index={index}
                compact={compact}
                showTechnical={showTechnical}
                interactive={interactive}
                idle={idle}
                onSelect={onStepSelect}
              />
            </div>
          );
        })}
      </div>

      {!mini && !hero && progress.percent >= 100 ? (
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
