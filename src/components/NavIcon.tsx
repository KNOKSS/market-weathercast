interface NavIconProps {
  name: "situation" | "weather" | "alerts" | "checklist";
}

export function NavIcon({ name }: NavIconProps) {
  if (name === "situation") {
    return (
      <svg className="nav-svg" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3.5v2.2M20.5 12h-2.2M12 20.5v-2.2M3.5 12h2.2M12 12l5.8-5.8" />
      </svg>
    );
  }

  if (name === "weather") {
    return (
      <svg className="nav-svg" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="8" cy="7" r="3.2" className="nav-sun" />
        <path d="M7.5 18.5h9.2a4.1 4.1 0 0 0 .2-8.2 5.7 5.7 0 0 0-10.7 1.8A3.3 3.3 0 0 0 7.5 18.5Z" className="nav-cloud" />
      </svg>
    );
  }

  if (name === "alerts") {
    return (
      <svg className="nav-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5" width="16" height="14" rx="2.5" />
        <path d="M8 9h8M8 12h8M8 15h5M7 3v3M17 3v3" />
      </svg>
    );
  }

  return (
    <svg className="nav-svg" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="4" width="14" height="16" rx="3" />
      <path d="M8.5 11.8 11 14.2l4.8-5M9 4V2.8h6V4" />
    </svg>
  );
}
