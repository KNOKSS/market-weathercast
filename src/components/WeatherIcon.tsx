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
      {sunny && (
        <g className={cloudy ? "icon-sun-group icon-sun-behind" : "icon-sun-group"}>
          <circle cx={cloudy ? 35 : 60} cy={cloudy ? 36 : 54} r={cloudy ? 18 : 25} className="icon-sun" />
          <g className="icon-rays">
            {cloudy ? (
              <>
                <path d="M35 8v10" />
                <path d="M7 36h10" />
                <path d="M15 16l7 7" />
                <path d="M55 16l-7 7" />
              </>
            ) : (
              <>
                <path d="M60 9v13" />
                <path d="M60 86v13" />
                <path d="M15 54h13" />
                <path d="M92 54h13" />
                <path d="M28 22l10 10" />
                <path d="M82 76l10 10" />
                <path d="M92 22 82 32" />
                <path d="M38 76 28 86" />
              </>
            )}
          </g>
        </g>
      )}
      {cloudy && (
        <path
          className="icon-cloud"
          d="M91 94H30C15 94 3 83 3 69c0-11 8-20 19-24 3-15 17-27 33-27 14 0 26 8 31 20 2 0 4-1 6-1 16 0 28 13 28 29 0 15-13 28-29 28Z"
        />
      )}
      {rainy && (
        <g className="icon-rain">
          <path d="M34 99l-6 12" />
          <path d="M59 99l-6 12" />
          <path d="M84 99l-6 12" />
        </g>
      )}
      {storm && <path className="icon-lightning" d="M63 84 49 105h14l-5 14 22-26H66l8-9Z" />}
    </svg>
  );
}
