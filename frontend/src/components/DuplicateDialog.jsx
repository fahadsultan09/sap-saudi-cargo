import { outcomeLabel } from "../lib/pipeline";

export default function DuplicateDialog({
  open,
  fileName,
  caseId,
  status,
  mode = "existing", // existing | possible
  onOpenExisting,
  onContinue,
  onDismiss,
}) {
  if (!open) return null;

  const isPossible = mode === "possible";

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="dup-title">
      <div className="modal">
        <h3 id="dup-title">{isPossible ? "Possible duplicate" : "Already uploaded"}</h3>
        <p>
          {isPossible ? (
            <>
              “{fileName || "This file"}” looks like an invoice that already exists on the desk
              {status ? ` (status: ${outcomeLabel(status)})` : ""}. Open the earlier case, or continue
              with this new one.
            </>
          ) : (
            <>
              “{fileName || "This file"}” was already uploaded, so it is not processed again. The
              existing invoice opens instead
              {status ? ` (status: ${outcomeLabel(status)})` : ""}.
            </>
          )}
        </p>
        {caseId ? (
          <p className="muted" style={{ marginTop: "-0.35rem" }}>
            Case {String(caseId).slice(0, 8)}…
          </p>
        ) : null}
        <div className="btn-row">
          {isPossible ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={onDismiss || onContinue}>
                Continue with new
              </button>
              <button type="button" className="btn btn-primary" onClick={onOpenExisting}>
                Open existing
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={onDismiss}>
                Stay here
              </button>
              <button type="button" className="btn btn-primary" onClick={onOpenExisting}>
                Open existing invoice
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
