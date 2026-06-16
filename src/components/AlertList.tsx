import type { MarketAlert } from "../types/market";

interface AlertListProps {
  alerts: MarketAlert[];
}

const levelClass: Record<MarketAlert["level"], string> = {
  안내: "info",
  주의보: "watch",
  경보: "warning",
  한숨: "sigh",
};

export function AlertList({ alerts }: AlertListProps) {
  return (
    <div className="alert-list">
      {alerts.map((alert) => (
        <article className={`alert-card alert-${levelClass[alert.level]}`} key={alert.id}>
          <div>
            <span>{alert.level}</span>
            <strong>{alert.title}</strong>
          </div>
          <p>{alert.message}</p>
        </article>
      ))}
    </div>
  );
}
