import { useMemo, useState } from "react";
import { explainMetric, type MetricKey } from "../engine/metricExplanations";
import type { WeatherScore } from "../types/market";
import { statusLabel } from "../utils/format";
import { Metric } from "./Metric";
import { WeatherIcon } from "./WeatherIcon";

interface WeatherCardProps {
  title: string;
  subtitle: string;
  score: WeatherScore;
}

export function WeatherCard({ title, subtitle, score }: WeatherCardProps) {
  const [activeMetric, setActiveMetric] = useState<MetricKey>("temperature");
  const explanation = useMemo(
    () => explainMetric(activeMetric, score),
    [activeMetric, score],
  );

  return (
    <section className={`weather-card weather-${score.label}`}>
      <div className="weather-card-main">
        <div>
          <p className="eyebrow">{subtitle}</p>
          <h1>{title}</h1>
          <div className="weather-label-row">
            <span className="weather-label">{score.label}</span>
            <span className="status-pill">{statusLabel(score.dataStatus)}</span>
          </div>
        </div>
        <WeatherIcon label={score.label} />
      </div>
      <p className="weather-summary">{score.summary}</p>
      <div className="metric-grid">
        <Metric
          label="시장 온도"
          value={`${score.temperature} / 100`}
          tone="warm"
          active={activeMetric === "temperature"}
          onClick={() => setActiveMetric("temperature")}
        />
        <Metric
          label="강수확률"
          value={`${score.rainChance}%`}
          tone="cool"
          active={activeMetric === "rain"}
          onClick={() => setActiveMetric("rain")}
        />
        <Metric
          label="바람"
          value={score.wind}
          tone="neutral"
          active={activeMetric === "wind"}
          onClick={() => setActiveMetric("wind")}
        />
        <Metric
          label="자외선"
          value={`${score.ultraviolet}`}
          tone="alert"
          active={activeMetric === "uv"}
          onClick={() => setActiveMetric("uv")}
        />
        <Metric
          label="미세먼지"
          value={score.dust}
          tone="neutral"
          active={activeMetric === "dust"}
          onClick={() => setActiveMetric("dust")}
        />
        <Metric
          label="RSI"
          value={score.rsi === null ? "-" : `${score.rsi}`}
          tone="neutral"
          active={activeMetric === "rsi"}
          onClick={() => setActiveMetric("rsi")}
        />
      </div>
      <article className="metric-explain" aria-live="polite">
        <strong>{explanation.title}</strong>
        <p>{explanation.summary}</p>
        <ul>
          {explanation.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      </article>
    </section>
  );
}
