// Pure helpers for the role cards (kind, power, "How you win", design §11,
// §20.2) and the end of game.
// Every number comes from content (with the game's overrides) or the view.
import { BUST_ROLE_TEXT, ROLES, ROLE_TEXT, ROLE_WIN, type RoleDef, type RoleId, type RoleKind } from "@skimjob/content";
import { roleHandler, rolesFor, type PlayerView } from "@skimjob/engine";
import { setupOf } from "./hud";


// ---------------------------------------------------------------- roles

export const KIND_LABEL: Readonly<Record<RoleKind, string>> = { eyes: "Eyes", shadows: "Shadows" };
/** What a kind means (design §11.1): no role is good or evil (§1.1). */
export const KIND_BLURB: Readonly<Record<RoleKind, string>> = {
  eyes: "Spots theft.",
  shadows: "Makes theft possible.",
};
const KIND_ORDER: readonly RoleKind[] = ["eyes", "shadows"];

/** The role table of a game (content overrides included), or plain content outside a game. */
export const rolesOf = (view: PlayerView | null): Readonly<Record<RoleId, RoleDef>> =>
  view ? rolesFor({ contentOverrides: setupOf(view)?.contentOverrides ?? null }) : ROLES;

export interface RoleInfo {
  readonly id: RoleId;
  readonly name: string;
  readonly kind: RoleKind;
  readonly kindLabel: string;
  /** Also wins a heist sunk by theft (★): the Mole and the Fixer, by their handlers (design §8.4). */
  readonly star: boolean;
  /** The power's line (design §20.2). */
  readonly power: string;
  readonly howYouWin: string;
}

export function roleInfo(id: RoleId, roles: Readonly<Record<RoleId, RoleDef>> = ROLES): RoleInfo {
  const def = roles[id];
  const text = Object.hasOwn(ROLE_TEXT, id) ? ROLE_TEXT[id] : undefined;
  if (!def || !text) return { id, name: id, kind: "eyes", kindLabel: KIND_LABEL.eyes, star: false, power: "", howYouWin: ROLE_WIN.crew };
  return {
    id,
    name: def.name,
    kind: def.kind,
    kindLabel: KIND_LABEL[def.kind],
    star: roleHandler(id).winsSunk !== undefined,
    power: text.power,
    howYouWin: ROLE_WIN[text.win],
  };
}

/** Roles grouped by kind (eyes, then shadows), in content order. design §11.1 */
export function rolesByKind(ids: readonly RoleId[], roles: Readonly<Record<RoleId, RoleDef>> = ROLES): { kind: RoleKind; label: string; roles: RoleId[] }[] {
  return KIND_ORDER.map((kind) => ({ kind, label: KIND_LABEL[kind], roles: ids.filter((r) => roles[r]?.kind === kind) })).filter((g) => g.roles.length > 0);
}

/** The role list shown to players (design §11.3): exact (with counts), possible or hidden. */
export function roleListInfo(view: PlayerView): { readonly title: string; readonly roles: readonly RoleId[] } {
  const l = view.roleList;
  if (!l) return { title: "The role list is hidden in this game.", roles: [] };
  return { title: l.list === "exact" ? "Roles in play" : "Roles that could be in play", roles: l.roles };
}

// ---------------------------------------------------------------- end of game

type Ending = ({ readonly result: "success" } | { readonly result: "failed"; readonly reason: "bust" | "theft" }) & { readonly winners: readonly string[] };

/**
 * How the game ended, in one line, and why each winner won. A failed heist's
 * ranking is a loss only when nobody won it (design §8.3, §8.4, §8.6).
 */
export function endingText(outcome: Ending): { title: string; badge: string; loss: boolean } {
  if (outcome.result === "success") return { title: "Job done: honest enough, and no bust", badge: "Biggest stash", loss: false };
  const loss = outcome.winners.length === 0;
  return outcome.reason === "bust"
    ? { title: `Busted. ${BUST_ROLE_TEXT.replace(/\.$/, "")}`, badge: "Wins over the Rooftop", loss } // design §20.2
    : { title: "Sunk by theft: too many coins went missing", badge: "Wins a heist sunk by theft", loss };
}
