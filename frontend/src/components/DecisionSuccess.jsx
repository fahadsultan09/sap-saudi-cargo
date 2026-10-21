/**
 * Post-decision / post-save exit modal so Review never feels stuck.
 * Intended path: Process → Review → decide/save → Open next | Desk | Home.
 */
export default function DecisionSuccess({
  title,
  eyebrow = "All set",
  message,
  postingNote,
  primaryLabel,
  onPrimary,
  secondaryLabel = "Back to Desk",
  onSecondary,
  tertiaryLabel = "Home",
  onTertiary,
  extraLabel,
  onExtra,
}) {
  return (
    <div
      className="modal-backdrop modal-backdrop--success"
      role="dialog"
      aria-modal="true"
      aria-labelledby="decision-success-title"
    >
      <div className="modal decision-success">
        <div className="decision-success__badge" aria-hidden="true">
          ✓
        </div>
        <p className="section-label">{eyebrow}</p>
        <h3 id="decision-success-title">{title}</h3>
        {postingNote ? <p className="decision-success__posting">{postingNote}</p> : null}
        {message ? <p className="decision-success__msg">{message}</p> : null}
        <div className="btn-row decision-success__actions">
          {onTertiary ? (
            <button type="button" className="btn btn-ghost" onClick={onTertiary}>
              {tertiaryLabel}
            </button>
          ) : null}
          {onSecondary ? (
            <button type="button" className="btn btn-ghost" onClick={onSecondary}>
              {secondaryLabel}
            </button>
          ) : null}
          {onExtra ? (
            <button type="button" className="btn btn-ghost" onClick={onExtra}>
              {extraLabel}
            </button>
          ) : null}
          {onPrimary ? (
            <button type="button" className="btn btn-primary" onClick={onPrimary}>
              {primaryLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
