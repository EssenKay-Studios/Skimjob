// Meetings kit (M2-7, ui-style "Vote window"): the drawn clock face with hands,
// the tally bars (hatched gold for the leader, green for what passed), the
// result banner, and the dialog sheet the vote window opens in.
import type { CSSProperties, ReactNode } from "react";
import { InfoTip } from "./InfoTip";
import { Shield } from "./icons";
import { Modal } from "./Modal";
import { SketchFrame } from "./SketchFrame";

/** A 36 px drawn clock: the long hand shows minutes left, the short one seconds (decorative; the text says the time). */
export function ClockFace({ ms, size = 36 }: { ms: number; size?: number }) {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = (Math.floor(s / 60) % 60) * 6;
  const seconds = (s % 60) * 6;
  return (
    <svg className="clock-face" viewBox="0 0 36 36" width={size} height={size} aria-hidden="true">
      <circle cx="19.4" cy="19.4" r="14" fill="var(--gold)" opacity=".55" />
      <circle cx="18" cy="18" r="14.4" fill="var(--paper-hi)" stroke="var(--ink)" strokeWidth="1.8" />
      {[0, 90, 180, 270].map((a) => (
        <path key={a} d="M18 5.6v2.6" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" transform={`rotate(${a} 18 18)`} />
      ))}
      <path className="clock-face__hand" d="M18 18V8.4" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" transform={`rotate(${minutes} 18 18)`} />
      <path className="clock-face__hand" d="M18 18V11" stroke="var(--clay-d)" strokeWidth="1.6" strokeLinecap="round" transform={`rotate(${seconds} 18 18)`} />
      <circle cx="18" cy="18" r="1.8" fill="var(--ink)" />
    </svg>
  );
}

export interface TallyBar {
  readonly key: string;
  readonly label: ReactNode;
  readonly votes: number;
  /** 0–1 of the longest bar. */
  readonly share: number;
  readonly leading?: boolean;
  readonly passed?: boolean;
}

/** One hatched bar per option; counts are one per ballot. */
export function TallyBars({ rows, label }: { rows: readonly TallyBar[]; label: string }) {
  return (
    <ul className="tally" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className={["tally__row", r.leading && "is-leading", r.passed && "is-passed"].filter(Boolean).join(" ")}>
          <span className="tally__label">{r.label}</span>
          <span className="tally__bar" aria-hidden="true">
            <span className="tally__fill" style={{ "--t-share": `${Math.round(r.share * 100)}%` } as CSSProperties} />
          </span>
          <span className="tally__votes num">
            {r.votes}
            <span className="visually-hidden">{r.votes === 1 ? " vote" : " votes"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export type BannerTone = "bad" | "info";

const BANNER_FILL: Record<BannerTone, string> = { bad: "var(--bad-l)", info: "var(--card-sand)" };

/** A taped note: a shakedown that fell through, a bot playing your seat. */
export function Banner({ tone = "info", seed, title, children }: { tone?: BannerTone; seed: string; title: ReactNode; children?: ReactNode }) {
  return (
    <SketchFrame seed={seed} radius={12} shadow={0.35} fill={BANNER_FILL[tone]} className={`banner banner--${tone}`} role="status">
      <p className="banner__title">{title}</p>
      {children && <div className="banner__body">{children}</div>}
    </SketchFrame>
  );
}

/** A shield on a taped note: who is protected from shakedowns until the next regular meeting. design §9.7 */
export function ProtectedBanner({ seed, children }: { seed: string; children: ReactNode }) {
  return (
    <SketchFrame seed={seed} radius={12} shadow={0.35} fill="var(--sight-l)" className="banner banner--protected" role="status">
      <span className="banner__shield">
        <Shield />
      </span>
      <p className="banner__title">
        <b>Protected</b> {children}
      </p>
      <InfoTip info={{ kind: "term", id: "protected" }} />
    </SketchFrame>
  );
}

export interface DialogSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly seed: string;
  /** Id of the dialog's heading. */
  readonly labelledBy: string;
  readonly children: ReactNode;
}

/**
 * A centred modal sheet, min(520px, 100%) wide, tilted -0.5°, springing in
 * from above (ui-style "Vote window"), on the shared Modal base.
 */
export function DialogSheet({ open, onClose, seed, labelledBy, children }: DialogSheetProps) {
  return (
    <Modal open={open} onClose={onClose} className="dialog" labelledBy={labelledBy}>
      <SketchFrame seed={seed} radius={20} shadow={0.55} tape className="dialog__sheet">
        {children}
      </SketchFrame>
    </Modal>
  );
}
