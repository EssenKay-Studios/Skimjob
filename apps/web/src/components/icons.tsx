// Hand-inked line icons (ui-style §6): ~1.8px ink, round caps, a small flat
// colour fill set slightly off the outline like misregistered print.
const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function Play() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6.6 4.6l9 5.3-9 5.6z" fill="#fff7ee" opacity=".28" transform="translate(1 .8)" />
      <path d="M6 4.2c3.4 1.8 6.2 3.6 9.2 5.7-3 2.1-5.9 4-9.2 5.9-.3-3.8-.3-7.8 0-11.6z" {...S} fill="currentColor" />
    </svg>
  );
}

export function Star() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.6l2.3 4.7 5.1.6-3.8 3.5 1 5.1-4.6-2.6-4.6 2.6 1-5.1-3.8-3.5 5.1-.6z" fill="#fff4de" transform="translate(.8 .9)" opacity=".7" />
      <path d="M10 2.6l2.3 4.7 5.1.6-3.8 3.5 1 5.1-4.6-2.6-4.6 2.6 1-5.1-3.8-3.5 5.1-.6z" {...S} stroke="#171230" />
    </svg>
  );
}

export function Door() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6.5 4.5h7.5v12h-7.5z" fill="var(--clay-l)" transform="translate(1 1)" />
      <path d="M5 17V3.6h8.6V17M3 17h13.6" {...S} />
      <path d="M10.6 10.4v.2" {...S} strokeWidth={2.6} />
    </svg>
  );
}

export function ArrowBack() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M12.6 4.4c-2.4 1.8-4.4 3.6-6.2 5.6 1.8 2 3.8 3.8 6.2 5.6" {...S} strokeWidth={2.2} />
    </svg>
  );
}

export function Plus() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10.2 4.2c-.2 4-.1 7.8.1 11.6M4.3 10.1c3.9-.2 7.7-.2 11.5.1" {...S} strokeWidth={2.1} />
    </svg>
  );
}

export function Copy() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="7.6" y="7.4" width="9" height="9.6" rx="2" fill="var(--gold)" opacity=".6" transform="translate(.8 .7)" />
      <rect x="7.2" y="7" width="9" height="9.6" rx="2" {...S} />
      <path d="M12.6 4.6V4c0-.8-.6-1.2-1.3-1.2H4.6c-.8 0-1.3.5-1.3 1.3v7c0 .7.5 1.3 1.3 1.3h.6" {...S} />
    </svg>
  );
}
