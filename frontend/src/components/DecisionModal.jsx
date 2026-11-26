import React, { useState } from "react";

export default function DecisionModal({ title, label, placeholder, submitText, minLength = 0, onSubmit, onCancel }) {
  const [text, setText] = useState("");
  const ready = text.trim().length >= minLength;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>{title}</h3>
        <p>{label}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          autoFocus
        />
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ready}
            onClick={() => onSubmit(text.trim())}
          >
            {submitText}
          </button>
        </div>
      </div>
    </div>
  );
}
