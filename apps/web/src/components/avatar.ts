// Blob-avatar helpers (ui-style "Player avatars"): initials and a crew colour
// picked from the style-dot palette (§2), both stable for a given name.
import { hashSeed } from "./sketch";

/** Crew colours: the §2 style-category dots. Cream text reads on all of them. */
export const CREW_COLOURS = ["#9a5541", "#c46686", "#b7684f", "#6a9bcc", "#788c5d", "#6b5aa6", "#3d5a80"] as const;

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

/** The crew colour for a name (or an explicit index, e.g. seat order). */
export function crewColour(key: string | number): string {
  const i = typeof key === "number" ? key : hashSeed(key.trim().toLowerCase());
  return CREW_COLOURS[((i % CREW_COLOURS.length) + CREW_COLOURS.length) % CREW_COLOURS.length]!;
}
