// Blob-avatar helpers (ui-style "Player avatars"): initials and a seat colour
// (`--seat-1` … `--seat-12` in theme.css). A seat number fixes the colour for
// the whole game; a name without a seat hashes into the same palette.
import { hashSeed } from "./sketch";

/** Number of seat colours: the most players a game has. */
export const SEAT_COLOURS = 12;

/** The 0-based seat of an engine player id (`p1` is seat 0, see the server's playerIdFor), or undefined for any other id. */
export function seatOfPlayer(id: string): number | undefined {
  const m = /^p(\d+)$/.exec(id);
  return m ? Number(m[1]) - 1 : undefined;
}

/** Up to two initials: first letters of the first two words, else the first letter. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .map((w) => Array.from(w.replace(/[^\p{L}\p{N}]/gu, ""))[0])
    .filter((c): c is string => !!c);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase();
}

/** The colour for a seat number (0-based) or, with no seat, for a name. */
export function crewColour(key: string | number): string {
  const i = typeof key === "number" ? key : hashSeed(key.trim().toLowerCase());
  return `var(--seat-${(((i % SEAT_COLOURS) + SEAT_COLOURS) % SEAT_COLOURS) + 1})`;
}
