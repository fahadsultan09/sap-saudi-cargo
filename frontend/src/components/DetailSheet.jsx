import { useEffect } from "react";
import { motion } from "framer-motion";

/**
 * Shared right-edge drawer used for progressive disclosure.
 * StageDetailSheet, invoice history, confidence, case meta, flags, fields all reuse this chrome.
 * Enter animation only — unmounts immediately on close so overlays never stick.
 */
export default function DetailSheet({
  open,
  title,
  eyebrow = "Details",
  glyph = "ⓘ",
  onClose,
  children,
  actions = null,
  wide = false,
  labelledBy = "detail-sheet-title",
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="stage-sheet" role="presentation">
      <button
        type="button"
        className="stage-sheet__backdrop"
        aria-label="Close details"
        onClick={onClose}
      />
      <motion.aside
        className={`stage-sheet__panel${wide ? " stage-sheet__panel--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 38 }}
      >
        <header className="stage-sheet__head">
          <div className="stage-sheet__orb" aria-hidden="true">
            <span>{glyph}</span>
          </div>
          <div className="stage-sheet__titles">
            <p className="section-label">{eyebrow}</p>
            <h2 id={labelledBy}>{title}</h2>
          </div>
          <button type="button" className="stage-sheet__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="stage-sheet__body">{children}</div>

        {actions ? <div className="stage-sheet__actions btn-row">{actions}</div> : null}
      </motion.aside>
    </div>
  );
}
