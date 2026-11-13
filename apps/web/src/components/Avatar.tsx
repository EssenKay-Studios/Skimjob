// Blob avatar: a slightly non-round ink circle in a crew colour with the
// player's initials in Pangolin (ui-style §6, "Player avatars").
import type { CSSProperties } from "react";
import { crewVar, crookLook } from "../art/crookLooks";
import { initialsOf } from "./avatarLooks";

export type AvatarStatus = "ready" | "away" | "turn";

export interface AvatarProps {
  readonly name: string;
  /** Diameter in px (36–46 in lists; 28 in dense rows). */
  readonly size?: number;
  /** The player's 0-based seat: it fixes the colour for the whole game (default: hashed from the name). */
  readonly seat?: number | undefined;
  /** ready: move submitted (clay dot); away: grey wash; turn: wobbling outline. */
  readonly status?: AvatarStatus | undefined;
  readonly bot?: boolean | undefined;
  readonly title?: string;
  /** Shown instead of the name's initials: the crew-unique tag (seatLooks), so two "Sam"s tell apart. */
  readonly initials?: string | undefined;
}

export function Avatar({ name, size = 40, seat, status, bot, title, initials }: AvatarProps) {
  const style = { "--av-size": `${size}px`, "--av-fill": crewVar(crookLook(seat ?? name).colour) } as CSSProperties;
  const cls = ["avatar", status && `avatar--${status}`].filter(Boolean).join(" ");
  const label = title ?? `${name}${bot ? " (bot)" : ""}${status === "ready" ? ", move in" : status === "away" ? ", away" : ""}`;
  return (
    <span className={cls} style={style} role="img" aria-label={label} title={label}>
      <span className="avatar__blob" aria-hidden="true">
        {initials ?? initialsOf(name)}
      </span>
      {bot && (
        <span className="avatar__bot" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="100%" height="100%">
            <rect x="2.5" y="4.5" width="11" height="8.5" rx="2.6" fill="#faf9f5" stroke="#2a2320" strokeWidth="1.4" />
            <path d="M8 4.4V2.2" stroke="#2a2320" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="5.8" cy="8.6" r="1.1" fill="#2a2320" />
            <circle cx="10.2" cy="8.6" r="1.1" fill="#2a2320" />
          </svg>
        </span>
      )}
      {status === "ready" && <span className="avatar__dot" aria-hidden="true" />}
    </span>
  );
}
