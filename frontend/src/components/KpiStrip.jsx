export default function KpiStrip({ items = [], activeKey = "", onSelect }) {
  return (
    <div className="kpi-strip" role="group" aria-label="Case totals">
      {items.map((item) => {
        const active = activeKey === item.key || (item.key === "total" && !activeKey);
        return (
          <button
            key={item.key}
            type="button"
            className={`kpi-card kpi-card--${item.tone || "brand"}${active ? " kpi-card--active" : ""}`}
            onClick={() => onSelect?.(item.key === "total" ? "" : item.key)}
          >
            <span className="kpi-card__label">{item.label}</span>
            <strong className="kpi-card__value">{item.value}</strong>
          </button>
        );
      })}
    </div>
  );
}
