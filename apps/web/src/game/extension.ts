// Pure helpers for the role cards (kind, power, token trigger, "How you win",
// design §11, §20.2) and the token shop with its perk uses (extension.md, until S3a.7).
// Every number comes from content (with the game's overrides) or the view.
import {
  BUST_ROLE_TEXT,
  PERKS,
  ROLES,
  ROLE_TEXT,
  ROLE_WIN,
  SHOP_COLUMNS,
  type PerkColumn,
  type PerkId,
  type RoleDef,
  type RoleId,
  type RoleKind,
  type TokenTrigger,
} from "@skimjob/content";
import { roleHandler, rolesFor, type PlayerId, type PlayerView, type RoomId } from "@skimjob/engine";
import { jobOf, setupOf } from "./hud";


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

/** When a role earns a token, in one line. extension.md "Roles" */
function earnsText(trigger: TokenTrigger): string {
  switch (trigger) {
    case "watchedShakenDirty":
      return "Someone it saw is caught.";
    case "auditedShakenDirty":
      return "A visitor of a room it audited is caught.";
    case "checkedShakenDirty":
      return "A player it looked into is caught.";
    case "wonDirtyShakedown":
      return "It votes to catch a cheater who is then caught.";
    default: {
      const never: never = trigger;
      return String(never);
    }
  }
}

export interface RoleInfo {
  readonly id: RoleId;
  readonly name: string;
  readonly kind: RoleKind;
  readonly kindLabel: string;
  /** Also wins a heist sunk by theft (★): the Mole and the Fixer, by their handlers (design §8.4). */
  readonly star: boolean;
  /** The power's line (design §20.2). */
  readonly power: string;
  /** "Earns a token when …", or null for a role with no reward. */
  readonly earns: string | null;
  readonly howYouWin: string;
}

export function roleInfo(id: RoleId, roles: Readonly<Record<RoleId, RoleDef>> = ROLES): RoleInfo {
  const def = roles[id];
  const text = Object.hasOwn(ROLE_TEXT, id) ? ROLE_TEXT[id] : undefined;
  if (!def || !text) return { id, name: id, kind: "eyes", kindLabel: KIND_LABEL.eyes, star: false, power: "", earns: null, howYouWin: ROLE_WIN.crew };
  const reward = def.rewards?.[0];
  return {
    id,
    name: def.name,
    kind: def.kind,
    kindLabel: KIND_LABEL[def.kind],
    star: roleHandler(id).winsSunk !== undefined,
    power: text.power,
    earns: reward ? `${reward.count === 1 ? "A token" : `${reward.count} tokens`} when: ${earnsText(reward.on).replace(/^./, (c) => c.toLowerCase())}` : null,
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
  /** You used a perk by choice this round (one per round; the Shield doesn't count). */
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
