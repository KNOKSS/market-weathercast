interface MetricProps {
  label: string;
  value: string;
  tone?: "neutral" | "warm" | "cool" | "alert";
  active?: boolean;
  onClick?: () => void;
}

export function Metric({ label, value, tone = "neutral", active = false, onClick }: MetricProps) {
  return (
    <button
      className={`metric metric-${tone} ${active ? "metric-active" : ""}`}
      type="button"
      onClick={onClick}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}
