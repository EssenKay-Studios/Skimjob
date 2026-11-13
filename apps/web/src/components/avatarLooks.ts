// Blob-avatar helper (ui-style "Player avatars"): the initials. The colour is the crew colour of the player's seat (art/crookLooks).

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
