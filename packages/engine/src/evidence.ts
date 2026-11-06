// Which case-file entries may become verified evidence cards in chat
// (apps/server chat.ts, apps/web game/chat.ts). Role cards can't: a player
// claims a role "truthfully or as a bluff" (design §8, §12.1 Claim button),
// and a one-tap verified proof of a role or faction would end bluffing
// (PM decision on PR #38). Ability results (sightings, audits, …) stay shareable.
import type { GameEvent, GameEventType } from "./types";

/**
 * Entries that are role cards by type, even where the payload names no role:
 * a token's trigger (and a landed tip-off) names the role that earned it.
 */
const ROLE_CARD_TYPES: ReadonlySet<GameEventType> = new Set<GameEventType>(["roleDealt", "tokenEarned", "tipOffLanded"]);

/** Payload keys that state a role or a faction (anyone's): a Peek, an Inside tip, a Double-cross swap, allies. */
const ROLE_KEYS: ReadonlySet<string> = new Set(["role", "roles", "faction", "allies"]);

function namesRole(value: unknown, depth = 0): boolean {
  if (depth > 6 || typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return value.some((v) => namesRole(v, depth + 1));
  return Object.entries(value).some(([k, v]) => ROLE_KEYS.has(k) || namesRole(v, depth + 1));
}

/** True when the event states a player's role or faction, so it can't be shared as a verified card. */
export function revealsRole(event: GameEvent): boolean {
  if (ROLE_CARD_TYPES.has(event.type)) return true;
  const { type: _type, visibility: _visibility, ...payload } = event as GameEvent & Record<string, unknown>;
  return namesRole(payload);
}
