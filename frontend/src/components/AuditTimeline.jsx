export default function AuditTimeline({ items = [], loading, error }) {
  if (loading) {
    return (
      <div className="empty-note empty-note--rich">
        <strong>Loading trail</strong>
        <span>Fetching events for this case…</span>
      </div>
    );
  }
  if (error) {
    return <div className="error-banner">{error}</div>;
  }
  if (!items.length) {
    return (
      <div className="empty-note empty-note--rich">
        <strong>No events yet</strong>
        <span>Uploads, field edits, and decisions will appear here.</span>
      </div>
    );
  }

  return (
    <ol className="audit-timeline">
      {items.map((item) => (
        <li key={item.id} className={`audit-timeline__item audit-timeline__item--${item.tone}`}>
          <div className="audit-timeline__dot" aria-hidden="true" />
          <div className="audit-timeline__body">
            <strong>{item.title}</strong>
            <p>{item.description}</p>
            {item.meta ? <span className="muted">{item.meta}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
