// The narrator of the "While you were away" recap (ui-style "Ledger / case
// file": our own mascot, a raccoon in a mask). Same ink-and-flat-fill look as
// the crooks; it blinks and bobs (ambient motion, off with reduced motion).
const INK = "var(--art-ink)";
const L = { stroke: INK, strokeWidth: 2.2, strokeLinejoin: "round", strokeLinecap: "round" } as const;

export function RaccoonNarrator({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <svg className={["raccoon", className].filter(Boolean).join(" ")} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="The crew's raccoon lookout">
      <title>The crew's raccoon lookout</title>
      <ellipse cx="33" cy="60" rx="20" ry="3.4" fill="var(--art-shade)" />
      <g className="raccoon__bob">
        {/* Ears */}
        <path d="M14 22 11 8l13 7z" fill="var(--art-slate-l)" {...L} />
        <path d="M50 22l3-14-13 7z" fill="var(--art-slate-l)" {...L} />
        <path d="M15 18 14 12l5 3z M49 18l1-6-5 3z" fill="var(--art-slate-d)" />
        {/* Head */}
        <path d="M8 34c0-13 11-21 24-21s24 8 24 21c0 12-10 21-24 21S8 46 8 34z" fill="var(--art-steel-l)" {...L} />
        {/* Cheek ruffs and the pale muzzle */}
        <path d="M10 40c4 3 8 3 11 1M54 40c-4 3-8 3-11 1" fill="none" {...L} strokeWidth={1.6} />
        <path d="M22 42c2-6 6-8 10-8s8 2 10 8c-2 5-6 8-10 8s-8-3-10-8z" fill="var(--paper-hi)" {...L} strokeWidth={1.8} />
        {/* The mask */}
        <path d="M11 31c5-5 12-6 17-2 2 1 3 1 4 1s2 0 4-1c5-4 12-3 17 2-2 6-8 9-14 7-3-1-5-1-7-1s-4 0-7 1c-6 2-12-1-14-7z" fill="var(--ink)" />
        {/* Eyes (blink) */}
        <g className="raccoon__eyes">
          <ellipse cx="22" cy="32" rx="3" ry="3.3" fill="var(--paper-hi)" />
          <ellipse cx="42" cy="32" rx="3" ry="3.3" fill="var(--paper-hi)" />
          <circle cx="22.8" cy="32.6" r="1.5" fill="var(--ink)" />
          <circle cx="42.8" cy="32.6" r="1.5" fill="var(--ink)" />
        </g>
        {/* Nose and mouth */}
        <path d="M29 40c1-1.4 5-1.4 6 0-.6 1.6-1.8 2.4-3 2.4s-2.4-.8-3-2.4z" fill="var(--ink)" />
        <path d="M32 42.6v2.4c-1 1.4-3 1.6-4.4.6M32 45c1 1.4 3 1.6 4.4.6" fill="none" {...L} strokeWidth={1.5} />
        <path d="M18 20c3-3 7-4 10-4" fill="none" stroke="var(--art-hi)" strokeWidth="2.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}
