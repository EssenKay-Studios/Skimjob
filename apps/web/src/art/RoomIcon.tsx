// Room icons (M2-9), one per bank room, matching the cutaway props: a 24-unit
// hand-inked line drawing with a small flat colour fill set slightly off the
// outline (ui-style §6). Ink is `currentColor`.
import type { BankRoomId } from "./bankLayout";

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const off = "translate(.9 .9)";

const GLYPHS: Record<BankRoomId, () => React.JSX.Element> = {
  vault: () => (
    <>
      <circle cx="12" cy="12" r="8.6" fill="var(--gold)" opacity=".75" transform={off} />
      <circle cx="12" cy="12" r="8.8" {...S} />
      <circle cx="12" cy="12" r="2.2" {...S} />
      <path d="M12 9.8V5.6M12 14.2v4.2M9.8 12H5.6M14.2 12h4.2M10.4 10.4 7.6 7.6M13.6 13.6l2.8 2.8M13.6 10.4l2.8-2.8M10.4 13.6l-2.8 2.8" {...S} strokeWidth={1.5} />
    </>
  ),
  office: () => (
    <>
      <rect x="5" y="4.6" width="14" height="10" rx="1.6" fill="var(--sky)" opacity=".55" transform={off} />
      <rect x="4.6" y="4.2" width="14.4" height="10.2" rx="1.8" {...S} />
      <path d="M11.8 14.6v3.4M7.6 18.6c2.8-.3 5.6-.3 8.4 0M2.8 21h18.6" {...S} />
      <path d="M7.4 11.4l2.6-2.4 2 1.6 3.4-3.2" {...S} strokeWidth={1.5} />
    </>
  ),
  lobby: () => (
    <>
      <path d="M4 9.6h16v9.6H4z" fill="var(--clay-l)" transform={off} />
      <path d="M3.2 9.2 12 3.6l8.8 5.6zM3.4 20.6h17.4M4.6 18.4h14.8" {...S} />
      <path d="M6.6 10.8v6.2M10.2 10.8v6.2M13.8 10.8v6.2M17.4 10.8v6.2" {...S} strokeWidth={1.7} />
    </>
  ),
  security: () => (
    <>
      <path d="M7 7.6l9.8 2.6-1.6 5.2-9.6-2.6z" fill="var(--art-steel-l)" transform={off} />
      <path d="M3.4 3.6v6.4M3.6 6.8h2.6" {...S} />
      <path d="M6.6 6.8l10.4 2.8-1.8 5.8-10.2-2.8z" {...S} />
      <path d="M17 11.2l3.6-.6v3.4l-4.4.8" {...S} />
      <path d="M11.2 15l-1 4.4" {...S} />
      <circle cx="9" cy="9.8" r="1.1" fill="var(--bad)" stroke="none" />
    </>
  ),
  rooftop: () => (
    <>
      <path d="M7.6 7.4h9v6.8h-9z" fill="var(--kraft)" transform={off} />
      <path d="M6.4 6.6 12 2.6l5.6 4z" fill="var(--clay)" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      <path d="M7.2 6.8v7.4h9.6V6.8M7.2 10.4h9.6" {...S} />
      <path d="M8.4 14.4 7.4 20M15.6 14.4l1 5.6M8.2 17.4h7.6" {...S} strokeWidth={1.6} />
      <path d="M2.6 21.2h18.8" {...S} />
    </>
  ),
  depositBoxes: () => (
    <>
      <rect x="3.6" y="4.4" width="17" height="15" rx="1.6" fill="var(--gold)" opacity=".55" transform={off} />
      <rect x="3.4" y="4.2" width="17.2" height="15.4" rx="1.8" {...S} />
      <path d="M3.6 11.8h16.8M12 4.4v15" {...S} strokeWidth={1.6} />
      <path d="M7.6 8h.2M16 8h.2M7.6 15.6h.2" {...S} strokeWidth={2.4} />
      <circle cx="16.2" cy="15.6" r="1.6" {...S} strokeWidth={1.5} />
    </>
  ),
  serverRoom: () => (
    <>
      <rect x="6" y="3" width="12.4" height="18" rx="1.6" fill="var(--art-led)" opacity=".45" transform={off} />
      <rect x="5.6" y="2.8" width="12.8" height="18.4" rx="1.8" {...S} />
      <path d="M5.8 8.8h12.4M5.8 14.8h12.4" {...S} strokeWidth={1.6} />
      <path d="M8.6 5.8h.2M8.6 11.8h.2M8.6 17.8h.2" {...S} strokeWidth={2.4} />
      <path d="M11.6 5.8h4M11.6 11.8h4M11.6 17.8h4" {...S} strokeWidth={1.4} />
    </>
  ),
  managersOffice: () => (
    <>
      <path d="M10.6 8.4 13.6 8.4 15.4 17.2 12.4 20.4 9.2 17.2z" fill="var(--clay)" opacity=".8" transform={off} />
      <path d="M7.4 3.6 12 6.4l4.6-2.8" {...S} />
      <path d="M10.4 6.4h3.2l-.6 2.2h-2z" {...S} />
      <path d="M10.8 8.6 9 17l3 3.4 3-3.4-1.8-8.4" {...S} />
      <path d="M10.4 12.6l3.4-1.6M9.8 15.6l4.6-2.2" {...S} strokeWidth={1.3} />
    </>
  ),
};

/** The 24-unit glyph as an SVG group (for use inside another SVG). */
export function RoomGlyph({ room }: { room: BankRoomId }) {
  const G = GLYPHS[room];
  return <G />;
}

export interface RoomIconProps {
  readonly room: BankRoomId;
  readonly size?: number;
  /** Accessible name; omit for decorative use next to a visible label. */
  readonly title?: string;
  readonly className?: string;
}

export function RoomIcon({ room, size = 24, title, className }: RoomIconProps) {
  return (
    <svg
      className={["room-icon", className].filter(Boolean).join(" ")}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true, focusable: false })}
    >
      {title && <title>{title}</title>}
      <RoomGlyph room={room} />
    </svg>
  );
}
