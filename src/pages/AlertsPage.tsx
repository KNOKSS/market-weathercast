import type { MarketAlert } from "../types/market";
import { AlertList } from "../components/AlertList";

interface AlertsPageProps {
  alerts: MarketAlert[];
}

export function AlertsPage({ alerts }: AlertsPageProps) {
  return (
    <div className="page-flow">
      <div className="section-head">
        <div>
          <p className="eyebrow">주의보 센터</p>
          <h2>오늘 뜬 알림</h2>
        </div>
      </div>
      <AlertList alerts={alerts} />
    </div>
  );
}
