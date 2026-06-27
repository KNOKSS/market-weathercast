import type { TomorrowForecastData } from "../types/market";

function isForecastData(value: unknown): value is TomorrowForecastData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TomorrowForecastData>;
  return candidate.schemaVersion === 1
    && candidate.model?.version === "v2"
    && Array.isArray(candidate.forecasts)
    && Array.isArray(candidate.recentSettlements);
}

export async function fetchTomorrowForecast(): Promise<TomorrowForecastData | null> {
  try {
    const response = await fetch(`/data/tomorrow-forecast.json?t=${Date.now()}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return isForecastData(payload) ? payload : null;
  } catch {
    return null;
  }
}
