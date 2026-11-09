// Role icons (design §15.6): one hand-inked 24-unit drawing per role, the same
// everywhere the role appears (role card, roles in play, rulebook, claims, case
// board). Style as the room icons: ink is `currentColor`, a flat fill set off the line.
import type { RoleId } from "@skimjob/content";

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
const off = "translate(.9 .9)";

const GLYPHS: Record<string, () => React.JSX.Element> = {
  // binoculars
  lookout: () => (
    <>
      <circle cx="7.6" cy="15" r="4" fill="var(--sky)" opacity=".7" transform={off} />
      <circle cx="16.4" cy="15" r="4" fill="var(--sky)" opacity=".7" transform={off} />
      <circle cx="7.4" cy="14.8" r="3.9" {...S} />
      <circle cx="16.6" cy="14.8" r="3.9" {...S} />
      <path d="M10.6 14.2h2.8M5.6 11.2 7.2 4.6h2.2l.8 6.6M18.4 11.2l-1.6-6.6h-2.2l-.8 6.6" {...S} />
    </>
  ),
  // key
  locksmith: () => (
    <>
      <circle cx="7.6" cy="8" r="4.2" fill="var(--gold)" opacity=".8" transform={off} />
      <circle cx="7.4" cy="7.8" r="4.1" {...S} />
      <circle cx="7.4" cy="7.8" r="1.1" {...S} strokeWidth={1.5} />
      <path d="M10.4 10.8 20 20.4M16.4 16.8l2.4-2.4M13.6 14l2-2" {...S} />
    </>
  ),
  // magnifier
  detective: () => (
    <>
      <circle cx="10.4" cy="10.4" r="6.4" fill="var(--sky)" opacity=".55" transform={off} />
      <circle cx="10.2" cy="10.2" r="6.3" {...S} />
      <path d="M15 15l5.6 5.6" {...S} strokeWidth={2.8} />
      <path d="M7.4 8.6c.8-1.2 1.8-1.8 3-1.9" {...S} strokeWidth={1.4} />
    </>
  ),
  // adding machine
  auditor: () => (
    <>
      <path d="M5.4 3.4h13.2v17.8H5.4z" fill="var(--kraft)" opacity=".7" transform={off} />
      <path d="M5 3h13.4v18H5z" {...S} />
      <path d="M8 6h8v3H8z" {...S} strokeWidth={1.6} />
      <path d="M8.4 12.4h.2M12 12.4h.2M15.6 12.4h.2M8.4 15.4h.2M12 15.4h.2M15.6 15.4h.2M8.4 18.2h.2M12 18.2h.2" {...S} strokeWidth={2.4} />
      <path d="M20.2 8.6c1.2 2 1.2 4 0 6" {...S} strokeWidth={1.5} />
    </>
  ),
  // two speech bubbles
  smoothTalker: () => (
    <>
      <path d="M3.6 4.4h10.4v6.8H8.6l-3.2 2.8v-2.8H3.6z" fill="var(--clay-l)" transform={off} />
      <path d="M3.2 4h10.4v7H8.4l-3.2 2.8V11H3.2z" {...S} />
      <path d="M11.6 13.4h8.4v5.8h-1.6V22l-3-2.8h-3.8z" {...S} />
      <path d="M6 7.6h5.2" {...S} strokeWidth={1.4} />
    </>
  ),
  // laptop
  hacker: () => (
    <>
      <rect x="5.4" y="5.4" width="14" height="9.6" rx="1.4" fill="var(--art-led)" opacity=".45" transform={off} />
      <rect x="5" y="5" width="14" height="9.6" rx="1.6" {...S} />
      <path d="M2.8 18.6h18.4l-1.4-3.6H4.2z" {...S} />
      <path d="M8.2 8.4l2 1.6-2 1.6M12 11.8h3.4" {...S} strokeWidth={1.5} />
    </>
  ),
  // plug
  electrician: () => (
    <>
      <path d="M7 8.6h10v4.6a5 5 0 0 1-10 0z" fill="var(--gold)" opacity=".75" transform={off} />
      <path d="M7 8h10v5a5 5 0 0 1-10 0zM9.4 8V3.4M14.6 8V3.4M12 18v3" {...S} />
    </>
  ),
  // praying hands
  priest: () => (
    <>
      <path d="M9.4 21 6.6 14.6C6 12 7 9 9 6l1.6-2.8c1.2 1.6 1.8 3.4 1.8 5.4" fill="var(--clay-l)" transform={off} />
      <path d="M12 21V8.4c0-2 1-3.6 1.6-5 1.2 1.2 2.6 3 3.2 5.2l.6 5.4L14.4 21z" fill="var(--clay-l)" transform={off} />
      <path d="M12 21V8.6C12 6.4 11 4.6 10 3 8.4 5.4 7 8 6.6 10.6c-.3 2 .2 3.4.8 4.8L9 21z" {...S} />
      <path d="M12 21V8.6c0-2 1-3.8 2-5.6 1.4 1.8 2.6 3.6 3 6l.4 5.4-2 6.6" {...S} />
    </>
  ),
  // a mole
  mole: () => (
    <>
      <ellipse cx="11.8" cy="14.4" rx="7.4" ry="5.4" fill="var(--kraft)" transform={off} />
      <path d="M4.4 14.4c0-3.2 3.2-5.6 7.2-5.6 2.6 0 4.8 1 6.2 2.6 1.4.4 2.6 1.2 3.6 2.4-1 .4-2 .6-3 .4-1.2 2-3.6 3.4-6.4 3.4-4 0-7.6-1.2-7.6-3.2z" {...S} />
      <path d="M19.8 13.8l1.8-.2" {...S} strokeWidth={1.4} />
      <circle cx="16" cy="12.2" r=".9" fill="currentColor" stroke="none" />
      <path d="M8.6 18.8l-.8 2M11.6 19.4l-.2 1.8M2.6 21.2h18.8" {...S} strokeWidth={1.6} />
    </>
  ),
  // scissors
  fixer: () => (
    <>
      <circle cx="6.4" cy="17.6" r="3.2" fill="var(--clay-l)" transform={off} />
      <circle cx="6.4" cy="6.4" r="3.2" fill="var(--clay-l)" transform={off} />
      <circle cx="6.2" cy="17.4" r="3.2" {...S} />
      <circle cx="6.2" cy="6.6" r="3.2" {...S} />
      <path d="M8.8 8.4 20.6 18M8.8 15.6 20.6 6" {...S} />
    </>
  ),
};

export interface RoleIconProps {
  readonly role: RoleId;
  readonly size?: number;
  readonly className?: string;
}

/** A role's icon; decorative, the role's name always sits next to it. */
export function RoleIcon({ role, size = 24, className }: RoleIconProps) {
  const G = Object.hasOwn(GLYPHS, role) ? GLYPHS[role] : undefined;
  if (!G) return null;
  return (
    <svg className={["role-icon", className].filter(Boolean).join(" ")} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable={false}>
      <G />
    </svg>
  );
}
