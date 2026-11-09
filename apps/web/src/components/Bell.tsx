// The board's alarm bell and the Wanted stars (design §5.1, §5.2, §5.4; ui-style
// "Alarm bells and Wanted stars"). Both are drawn from numbers the caller reads
// from content (`bulbs`, `bustStars`), never fixed here.
import { Bell as BellIcon } from "./icons";
import "./bell.css";

/** One bulb's look: off, lit at a step of the olive → gold → clay → bad ramp (1–4), previewed, or hidden. */
export type Bulb = "off" | "l1" | "l2" | "l3" | "l4" | "pv" | "q";

/** The bulbs of a bell: the lit ones (a ramp from olive to red over `bulbs`), then the ones your own grab would add. */
export function bellBulbs(bulbs: number, lit: number, preview = 0, hidden = false): Bulb[] {
  return Array.from({ length: bulbs }, (_, i): Bulb => {
    if (hidden) return "q";
    if (i < lit) return `l${Math.ceil(((i + 1) / bulbs) * 4)}` as Bulb;
    return i < lit + preview ? "pv" : "off";
  });
}

export interface AlarmBellProps {
  /** Bulbs on the bell, from content. design §5.1 */
  readonly bulbs: number;
  /** Lit bulbs. design §5.2 */
  readonly lit: number;
  /** Bulbs your own grab would add while planning. design §5.2 */
  readonly preview?: number;
  /** A bell a Hacker hid: "?" to everyone else. design §5.1 */
  readonly hidden?: boolean;
  /** xs on narrow rooms. */
  readonly size?: "md" | "xs";
}

/** The bell's name for screen readers. */
export function bellLabel({ bulbs, lit, preview = 0, hidden = false }: AlarmBellProps): string {
  if (hidden) return "Bell: hidden";
  return `Bell: ${lit} of ${bulbs} lit${preview > 0 ? `, your grab adds ${Math.min(preview, bulbs - lit)}` : ""}`;
}

/** The bell's width in px for `bulbs` bulbs, as bell.css lays it out (the board decides from it whether the bell fits beside a room's name). */
export function bellWidth({ bulbs, hidden = false, size = "md" }: Pick<AlarmBellProps, "bulbs" | "hidden" | "size">): number {
  return (size === "xs" ? 33.8 + bulbs * 9 : 28.8 + bulbs * 14) + (hidden ? 10 : 0);
}

export function AlarmBell(props: AlarmBellProps) {
  const { bulbs, lit, preview = 0, hidden = false, size = "md" } = props;
  return (
    <span className={size === "xs" ? "bell bell--xs" : "bell"} role="img" aria-label={bellLabel(props)}>
      <span className="bell__icon" aria-hidden="true">
        <BellIcon />
      </span>
      {bellBulbs(bulbs, lit, preview, hidden).map((b, i) => (
        <i key={i} className={`bulb bulb--${b}`} />
      ))}
      {hidden && (
        <b className="bell__q" aria-hidden="true">
          ?
        </b>
      )}
    </span>
  );
}

/** A five-point sheriff's star in a 20-unit box. */
const STAR = Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5;
  const r = i % 2 ? 3.7 : 8.8;
  return `${i ? "L" : "M"}${(10 + r * Math.cos(a)).toFixed(1)} ${(10 + r * Math.sin(a)).toFixed(1)}`;
}).join("") + "Z";

/** Wanted: one star per raid, `max` stars make a bust (design §5.4, §5.5). */
export function WantedStars({ stars, max }: { readonly stars: number; readonly max: number }) {
  return (
    <span className="wanted" role="img" aria-label={`Wanted ${stars} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <svg key={i} className={i < stars ? "wanted__star is-on" : "wanted__star"} viewBox="0 0 20 20" aria-hidden="true">
          <path d={STAR} />
        </svg>
      ))}
    </span>
  );
}
