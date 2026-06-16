import type { WeatherLabel } from "../types/market";

interface WeatherIconProps {
  label: WeatherLabel;
  size?: number;
}

export function WeatherIcon({ label, size = 96 }: WeatherIconProps) {
  const storm = label === "태풍경보";
  const rainy = label === "소나기" || storm;
  const cloudy = label === "구름 조금" || label === "흐림" || rainy;
  const sunny = label === "쾌청" || label === "맑음" || label === "구름 조금";

  return (
    <svg
      className={`weather-icon weather-icon-${label}`}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label={label}
    >
      {sunny && <circle cx="44" cy="42" r="22" className="icon-sun" />}
      {cloudy && (
        <path
          className="icon-cloud"
          d="M34 76h50c13 0 24-10 24-23s-11-23-24-23c-3 0-6 1-9 2-7-14-21-23-38-23-22 0-40 18-40 40 0 2 0 4 1 6-12 3-21 13-21 26 0 15 12 27 27 27h80"
          transform="translate(8 -2)"
        />
      )}
      {!cloudy && sunny && (
        <g className="icon-rays">
          <path d="M44 9v12" />
          <path d="M44 63v12" />
          <path d="M11 42h12" />
          <path d="M65 42h12" />
          <path d="M20 18l9 9" />
          <path d="M59 57l9 9" />
          <path d="M68 18l-9 9" />
          <path d="M29 57l-9 9" />
        </g>
      )}
      {rainy && (
        <g className="icon-rain">
          <path d="M38 86l-8 17" />
          <path d="M61 86l-8 17" />
          <path d="M84 86l-8 17" />
        </g>
      )}
      {storm && <path className="icon-lightning" d="M62 74 48 99h16l-7 16 24-29H65l9-12z" />}
    </svg>
  );
}
