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

/** Private rows in the case file ("only you"). */
export function Lock() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="5.4" y="9.4" width="10" height="7.4" rx="1.6" fill="var(--clay-l)" transform="translate(.8 .8)" />
      <rect x="4.6" y="8.8" width="10.8" height="8" rx="1.8" {...S} />
      <path d="M7.2 8.6V6.4c0-1.7 1.2-3 2.8-3s2.8 1.3 2.8 3v2.2" {...S} />
      <path d="M10 12.2v1.6" {...S} strokeWidth={2.2} />
    </svg>
  );
}

/** Countdowns. */
export function Clock() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="7" fill="var(--gold)" opacity=".55" />
      <circle cx="10" cy="10" r="7.2" {...S} />
      <path d="M10 5.8V10l2.8 1.8" {...S} />
    </svg>
  );
}

/** Chat (M2-8b): a speech bubble. */
export function Bubble() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4.4 5.2h11.4v7.6H9.2l-3.6 3v-3H4.4z" fill="var(--clay-l)" transform="translate(.8 .8)" />
      <path d="M3.6 4.4c4.2-.3 8.4-.3 12.6 0 .3 2.6.3 5.3 0 8-2.4.2-4.6.2-7 .2l-3.8 3.1.2-3.1H3.6c-.3-2.7-.3-5.5 0-8.2z" {...S} />
    </svg>
  );
}

/** Send a chat message: a paper plane. */
export function Send() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.4 9.6l13.2-5.8-4.4 13-2.6-5.2z" {...S} fill="currentColor" fillOpacity=".18" />
      <path d="M9.6 11.6l7-7.8" {...S} />
    </svg>
  );
}

/** Close a sheet. */
export function Close() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5.2 5c3.3 3.2 6.5 6.6 9.6 10.2M14.9 4.9c-3.4 3.2-6.6 6.6-9.8 10" {...S} strokeWidth={2.1} />
    </svg>
  );
}

/** Evidence cards: a clipped polaroid. */
export function Evidence() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="4.6" y="4.8" width="11" height="12" rx="1.4" fill="var(--manilla)" transform="translate(.8 .7)" />
      <rect x="4.2" y="4.2" width="11.4" height="12.4" rx="1.6" {...S} />
      <path d="M6.6 7.2h6.6v4.6H6.6zM6.8 14.2h4.6" {...S} strokeWidth={1.5} />
      <path d="M8.4 2.6v3.4" {...S} strokeWidth={2.2} />
    </svg>
  );
}

/** The alarm bell: a lead where a room rang. */
export function Bell() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5.6 14.4c1-1.2 1.2-2.4 1.2-4.6 0-2 1.3-3.4 3.2-3.4s3.2 1.4 3.2 3.4c0 2.2.2 3.4 1.2 4.6z" fill="var(--gold)" transform="translate(.7 .7)" />
      <path d="M5 14.2c1-1.2 1.2-2.4 1.2-4.6 0-2 1.3-3.4 3.8-3.4s3.8 1.4 3.8 3.4c0 2.2.2 3.4 1.2 4.6zM8.6 16.6h2.8M10 3.8v2.4" {...S} />
    </svg>
  );
}

/** "Doesn't add up": a warning triangle. */
export function Warn() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3.4 17.2 16H2.8z" fill="var(--gold)" transform="translate(.7 .7)" />
      <path d="M10 3 17 16H3zM10 8v3.6M10 13.6v.2" {...S} />
    </svg>
  );
}

/** A pin on a lead or a fact: filled clay head and a tick mark when pinned, a hollow outline when not (shape, not colour alone). */
export function Pin({ on = false }: { on?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="7" r="4.2" {...S} fill={on ? "var(--clay)" : "none"} strokeWidth={on ? 2.4 : 1.6} />
      <path d="M10 11.4v5.6" {...S} strokeWidth={on ? 2.4 : 1.6} />
      {on && <path d="M8.2 7.2l1.3 1.4 2.4-2.8" {...S} strokeWidth={1.6} />}
    </svg>
  );
}
