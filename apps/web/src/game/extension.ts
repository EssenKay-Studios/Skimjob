// Pure helpers for the Extension's player-facing pieces (docs/extension.md):
// role cards (tag, power, token trigger, "How you win") and the token shop with its perk uses.
// Every number comes from content (with the game's overrides) or the view.
import {
  BUST_ROLE_TEXT,
  PERKS,
  ROLES,
  SHOP_COLUMNS,
  type FailureReason,
  type PerkColumn,
  type PerkId,
  type RoleDef,
  type RoleId,
  type RolePower,
  type Temperament,
  type TokenTrigger,
} from "@skimjob/content";
import { rolesFor, type PlayerId, type PlayerView, type RoomId } from "@skimjob/engine";
import { roleName, roomName } from "./describeEvent";
import { jobOf, setupOf } from "./hud";


// ---------------------------------------------------------------- roles

export const TAG_LABEL: Readonly<Record<Temperament, string>> = { teamPlayer: "Team player", wildcard: "Wildcard", loneWolf: "Lone wolf" };
/** What a tag means (it changes no rule). extension.md "Roles" */
export const TAG_BLURB: Readonly<Record<Temperament, string>> = {
  teamPlayer: "Its power helps the crew.",
  wildcard: "Its power can help or hurt the crew.",
  loneWolf: "Its power works against the crew.",
};
const TAG_ORDER: readonly Temperament[] = ["teamPlayer", "wildcard", "loneWolf"];

/** The role table of a game (content overrides included), or plain content outside a game. */
export const rolesOf = (view: PlayerView | null): Readonly<Record<RoleId, RoleDef>> =>
  view ? rolesFor({ contentOverrides: setupOf(view)?.contentOverrides ?? null }) : ROLES;

/** "How you win" (extension.md "Winning and losing"), from `winsOn`. */
export function howYouWin(winsOn: readonly FailureReason[]): string {
  const base = "Have the biggest stash when the job succeeds";
  if (winsOn.includes("theft")) return `${base}, or the biggest of all when the heist is sunk by theft.`;
  return `${base}.`;
}

const times = (n: number) => (n === 1 ? "Once" : `${n} times`);

/** A role's power in one line, numbers from content (and the job's). extension.md "Roles" */
function powerText(power: RolePower): string {
  const between = (n: number) => `${times(n)} between meetings`;
  switch (power.kind) {
    case "none":
      return "No power.";
    case "lookout":
      return `Sees who was in ${power.extraRooms === 1 ? "one extra room" : `${power.extraRooms} extra rooms`} every round.`;
    case "loopCameras":
      return `${between(power.perStretch)}: loops one room's cameras, which then read "camera offline".`;
    case "voteWeight":
      return `Its vote counts ${power.weight === 2 ? "double" : `${power.weight} times`}.`;
    case "audit":
      return `${between(power.perStretch)}: how much went missing in one room last round.`;
    case "checkStash":
      return `${between(power.perStretch)}: does one player hold anything above the share?`;
    case "bless":
      return `${between(power.perStretch)}: bless a player; if they're shaken down clean, you earn a token.`;
    case "reopen":
      return "Once a game: tears the tape off a raided room, which opens again next round.";
    case "ring":
      return `${between(power.perStretch)}: rings one room's bell once (not the Rooftop or a taped-off room), like any noisy coin.`;
    default: {
      const never: never = power;
      return String((never as { kind: string }).kind);
    }
  }
}

/** When a role earns a token, in one line. extension.md "Roles" */
function earnsText(trigger: TokenTrigger): string {
  switch (trigger) {
    case "watchedShakenDirty":
      return "Someone it saw is caught.";
    case "auditedShakenDirty":
      return "A visitor of a room it audited is caught.";
    case "checkedShakenDirty":
      return "A player it checked is caught.";
    case "wonDirtyShakedown":
      return "It votes to catch a cheater who is then caught.";
    case "blessedShakenClean":
      return "A player it blessed is shaken down clean.";
    case "loopHidPocketer":
      return "A loop hid someone who pocketed.";
    default: {
      const never: never = trigger;
      return String(never);
    }
  }
}

export interface RoleInfo {
  readonly id: RoleId;
  readonly name: string;
  readonly tag: Temperament;
  readonly tagLabel: string;
  /** Also wins a failed heist (★). */
  readonly star: boolean;
  readonly power: string;
  /** "Earns a token when …", or null for a role with no reward. */
  readonly earns: string | null;
  readonly howYouWin: string;
  readonly minPlayers: number | null;
}

export function roleInfo(id: RoleId, roles: Readonly<Record<RoleId, RoleDef>> = ROLES): RoleInfo {
  const def = roles[id];
  if (!def) return { id, name: id, tag: "teamPlayer", tagLabel: TAG_LABEL.teamPlayer, star: false, power: "", earns: null, howYouWin: howYouWin([]), minPlayers: null };
  const reward = def.rewards?.[0];
  return {
    id,
    name: def.name,
    tag: def.tag,
    tagLabel: TAG_LABEL[def.tag],
    star: def.winsOn.length > 0,
    power: powerText(def.power),
    earns: reward ? `${reward.count === 1 ? "A token" : `${reward.count} tokens`} when: ${earnsText(reward.on).replace(/^./, (c) => c.toLowerCase())}` : null,
    howYouWin: howYouWin(def.winsOn),
    minPlayers: def.minPlayers ?? null,
  };
}

/** Roles grouped by tag, in content order. */
export function rolesByTag(ids: readonly RoleId[], roles: Readonly<Record<RoleId, RoleDef>> = ROLES): { tag: Temperament; label: string; roles: RoleId[] }[] {
  return TAG_ORDER.map((tag) => ({ tag, label: TAG_LABEL[tag], roles: ids.filter((r) => roles[r]?.tag === tag) })).filter((g) => g.roles.length > 0);
}

/** The role list shown to players (extension.md "Host settings"): exact, possible or hidden. */
export function roleListInfo(view: PlayerView): { readonly title: string; readonly roles: readonly RoleId[] } {
  const l = view.roleList;
  if (!l) return { title: "The role list is hidden in this game.", roles: [] };
  return { title: l.list === "exact" ? "Roles in play" : "Roles that could be in play", roles: l.roles };
}

// ---------------------------------------------------------------- tokens and the shop

export interface ShopItem {
  readonly perk: PerkId;
  readonly name: string;
  readonly effect: string;
  readonly cost: number;
  readonly column: PerkColumn;
  readonly affordable: boolean;
  /** How many you own (bought, not yet used). */
  readonly owned: number;
  /** Spent by itself (Shield, Emergency). */
  readonly auto: boolean;
}

export interface ShopState {
  /** This game has a shop. */
  readonly open: boolean;
  readonly tokens: number;
  readonly items: readonly ShopItem[];
  /** Perks you own that aren't in the shop (e.g. after an override); rare. */
  readonly extra: readonly { readonly perk: PerkId; readonly count: number }[];
  /** You used a perk by choice this round (one per round; Shield and Emergency don't count). */
  readonly usedThisRound: boolean;
}

export const COLUMN_LABEL: Readonly<Record<PerkColumn, string>> = { learn: "Learn", protect: "Protect", sway: "Sway" };

const columnOf = (perk: PerkId): PerkColumn =>
  (Object.entries(SHOP_COLUMNS).find(([, ps]) => ps.includes(perk))?.[0] as PerkColumn | undefined) ?? PERKS[perk]?.column ?? "learn";

/** Whether you used a perk by choice in the current round (from your case file). extension.md "Tokens and the perk shop" */
export function usedPerkThisRound(view: Pick<PlayerView, "caseFile" | "round" | "me">): boolean {
  return view.caseFile.some(
    ({ event: e }) => e.type === "perkUsed" && e.player === view.me.id && e.round === view.round && e.perk.kind !== "shield",
  );
}

export function shopState(view: PlayerView): ShopState {
  const tokens = view.me.roleState.tokens;
  const counts = new Map<PerkId, number>();
  for (const p of view.me.roleState.perks) counts.set(p, (counts.get(p) ?? 0) + 1);
  const items = view.shop.map(({ perk, cost }) => ({
    perk,
    name: PERKS[perk]?.name ?? perk,
    effect: PERKS[perk]?.effect ?? "",
    cost,
    column: columnOf(perk),
    affordable: tokens >= cost,
    owned: counts.get(perk) ?? 0,
    auto: PERKS[perk]?.spent === "auto",
  }));
  const extra = [...counts].filter(([p]) => !view.shop.some((s) => s.perk === p)).map(([perk, count]) => ({ perk, count }));
  return { open: view.shop.length > 0, tokens, items, extra, usedThisRound: usedPerkThisRound(view) };
}

/** A perk you can spend outside a meeting right now (meeting perks are offered on the vote screen). */
export type PerkUse =
  | { readonly kind: "peek"; readonly targets: readonly PlayerId[] }
  | { readonly kind: "tail"; readonly rooms: readonly RoomId[] }
  | { readonly kind: "alibi"; readonly round: number; readonly room: RoomId }
  | { readonly kind: "recharge" }
  | { readonly kind: "rig" }
  | { readonly kind: "rigPick"; readonly round: number; readonly cards: readonly string[]; readonly picked: string };

const lastResolved = (view: PlayerView): number => {
  let r = 0;
  for (const { event } of view.ledger) if (event.type === "roundResolved") r = event.round;
  return r;
};

/**
 * The perks you own that you can spend now, outside the meeting screen. Hints
 * only: the engine has the last word and its refusal is shown as a toast.
 * The Rig's pick isn't a perk use, so it shows even after one this round.
 */
export function perkUses(view: PlayerView): PerkUse[] {
  const p = view.phase.kind;
  if (p === "ended" || p === "setup") return [];
  const out: PerkUse[] = [];
  const rigged = view.caseFile
    .map((x) => x.event)
    .filter((e) => e.type === "perkUsed" && e.player === view.me.id && e.perk.kind === "rig")
    .at(-1);
  if (rigged?.type === "perkUsed" && rigged.perk.kind === "rig" && rigged.perk.round > view.round) {
    const round = rigged.perk.round;
    let picked = rigged.perk.cards[0] ?? "";
    for (const { event: e } of view.caseFile) if (e.type === "rigPicked" && e.player === view.me.id && e.round === round) picked = e.card;
    out.push({ kind: "rigPick", round, cards: rigged.perk.cards, picked });
  }
  if (usedPerkThisRound(view)) return out;
  const own = new Set(view.me.roleState.perks);
  const others = view.players.map((x) => x.id);
  if (own.has("peek")) out.push({ kind: "peek", targets: others });
  if (own.has("tail") && p === "planning" && view.me.roleState.tail === null) out.push({ kind: "tail", rooms: view.rooms });
  if (own.has("alibi")) {
    const round = lastResolved(view);
    const posted = view.ledger.find((x) => x.event.type === "alibiPosted" && x.event.player === view.me.id && x.event.round === round)?.event;
    const verified = view.ledger.some((x) => x.event.type === "alibiVerified" && x.event.player === view.me.id && x.event.round === round);
    if (round > 0 && posted?.type === "alibiPosted" && !verified) out.push({ kind: "alibi", round, room: posted.room });
  }
  if (own.has("recharge") && (view.me.roleState.usedThisStretch > 0 || view.me.roleState.usedThisGame > 0)) {
    out.push({ kind: "recharge" });
  }
  if (own.has("rig") && view.round < jobOf(view).roundCap && setupOf(view)?.eventsEnabled !== false && !out.some((u) => u.kind === "rigPick")) out.push({ kind: "rig" });
  return out;
}

// ---------------------------------------------------------------- end of game

type Ending = ({ readonly result: "success" } | { readonly result: "failed"; readonly reason: FailureReason }) & { readonly winners: readonly string[] };

/**
 * How the game ended, in one line, and why each winner won. A failed heist's
 * ranking is a loss only when nobody qualified through winsOn. extension.md "Winning and losing"
 */
export function endingText(outcome: Ending): { title: string; badge: string; loss: boolean } {
  if (outcome.result === "success") return { title: "Job done: honest enough, and no bust", badge: "Biggest stash", loss: false };
  const loss = outcome.winners.length === 0;
  return outcome.reason === "bust"
    ? { title: `Busted. ${BUST_ROLE_TEXT.replace(/\.$/, "")}`, badge: "Wins over the Rooftop", loss } // design §20.2
    : { title: "Sunk by theft: too many coins went missing", badge: "Wins a heist sunk by theft", loss };
}
