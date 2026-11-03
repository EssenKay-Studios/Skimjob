// Pure helpers for the Extension's player-facing pieces (docs/extension.md):
// role cards (tag, power, token trigger, "How you win"), the Haul target bar,
// the Heat breakdown, the gap box, and the token shop with its perk uses.
// Every number comes from content (with the game's overrides) or the view.
import {
  BAGMAN_STREAK,
  BANK_JOB,
  CLEANER_REWARD_EVERY,
  PERKS,
  POLICE_ACTIVITY,
  ROUNDS_PER_ACT,
  ROLES,
  SHOP_COLUMNS,
  type FailureReason,
  type JobDef,
  type PerkColumn,
  type PerkId,
  type RoleDef,
  type RoleId,
  type RolePower,
  type Temperament,
  type TokenTrigger,
} from "@skimjob/content";
import { heatBreakdown, rolesFor, type GameEvent, type PlayerId, type PlayerView, type RoomId } from "@skimjob/engine";
import { cardName, roleName, roomName } from "./describeEvent";
import { crewSize, jobOf, nextTarget, setupOf } from "./hud";

// ---------------------------------------------------------------- wording

export { meetingName, MeetingName, meetingAfter } from "./wording";

const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

// ---------------------------------------------------------------- roles

export const TAG_LABEL: Readonly<Record<Temperament, string>> = { teamPlayer: "Team player", wildcard: "Wildcard", loneWolf: "Lone wolf" };
/** What a tag means (it changes no rule). extension.md "Roles" */
export const TAG_BLURB: Readonly<Record<Temperament, string>> = {
  teamPlayer: "Its power helps the crew.",
  wildcard: "Its power can help or hurt the crew.",
  loneWolf: "Its power works against the crew.",
};
export const TAG_ORDER: readonly Temperament[] = ["teamPlayer", "wildcard", "loneWolf"];

/** The role table of a game (content overrides included), or plain content outside a game. */
export const rolesOf = (view: PlayerView | null): Readonly<Record<RoleId, RoleDef>> =>
  view ? rolesFor({ contentOverrides: setupOf(view)?.contentOverrides ?? null }) : ROLES;

/** "How you win" (extension.md "Winning and losing"), from `winsOn`. */
export function howYouWin(winsOn: readonly FailureReason[]): string {
  const base = "Have the biggest stash when the job succeeds";
  const raid = winsOn.includes("heat");
  const missed = winsOn.includes("target");
  if (raid && missed) return `${base}, or when it fails either way.`;
  if (raid) return `${base}, or when the cops raid.`;
  if (missed) return `${base}, or when the final target is missed.`;
  return `${base}.`;
}

const times = (n: number) => (n === 1 ? "Once" : `${n} times`);

/** A role's power in one line, numbers from content (and the job's). extension.md "Roles" */
export function powerText(power: RolePower, job: JobDef = BANK_JOB, def?: RoleDef): string {
  const between = (n: number) => `${times(n)} between meetings`;
  switch (power.kind) {
    case "none":
      return def && def.scoring.lootPerPointOverFinalTarget > 0
        ? `Can't pocket; +1 score per ${def.scoring.lootPerPointOverFinalTarget} loot the Haul ends above the final target.`
        : def && !def.canPocket
          ? "Can't pocket."
          : "No power.";
    case "lookout":
      return `Sees who was in ${power.extraRooms === 1 ? "one extra room" : `${power.extraRooms} extra rooms`} every round.`;
    case "fenceSafe":
      return `Hides up to ${power.perAct} loot between meetings in a safe that shakedowns show but can't take.`;
    case "loopCameras":
      return `${between(power.perAct)}: loops one room's cameras, which then read "camera offline".`;
    case "voteWeight":
      return `Its vote counts ${power.weight === 2 ? "double" : `${power.weight} times`}.`;
    case "cancelShakedown":
      return `${power.perGame === 1 ? "Once" : `${power.perGame} times`} per game: cancel a shakedown that passed.`;
    case "blackmail":
      return `${between(power.perAct)}: guess a player's role; if right, it steals their vote at the next meeting.`;
    case "forge":
      return `${between(power.perAct)}: plants a fake sighting on that round's camera and Lookout feeds.`;
    case "embezzle":
      return `${between(power.perAct)}: moves ${power.take} loot from the Haul into its stash; while holding a take, a shakedown always catches it.`;
    case "audit":
      return `${between(power.perAct)}: how much went missing in one room last round.`;
    case "checkStash":
      return `${between(power.perAct)}: is one player's stash "dirty" (${job.shakedown.cleanBelow} or more)?`;
    case "snitch":
      return "Has a secret target.";
    case "bless":
      return `${between(power.perAct)}: bless a player; if they're shaken down clean, the bank pays the ${job.shakedown.payout}.`;
    case "bagman":
      return `When it hands in everything, the bank adds +${power.bonus} to the Haul.`;
    case "cleaner":
      return `Its ${roomName(power.room)} visit cools Heat like ${power.visitors === 2 ? "two people" : `${power.visitors} people`}.`;
    case "fixer":
      return `Once, automatically: stops a raid at Heat ${power.stopAt}, losing ${power.lossShare === 0.25 ? "a quarter" : `${Math.round(power.lossShare * 100)}%`} of its stash.`;
    case "foresee":
      return "Sees the next event card early (events on only).";
    case "getaway":
      return `Its ${roomName(power.room)} visit doesn't really cool Heat.`;
    case "tipOff":
      return `${between(power.perAct)}, any time: tips off the cops for +${POLICE_ACTIVITY.heat} Heat, announced only as "police activity".`;
    default: {
      const never: never = power;
      return String((never as { kind: string }).kind);
    }
  }
}

/** When a role earns a token, in one line. extension.md "Roles" */
export function earnsText(trigger: TokenTrigger, def?: RoleDef): string {
  const p = def?.power;
  switch (trigger) {
    case "checkpointMade":
      return "The Haul target is met at meeting 1 or 2.";
    case "watchedShakenDirty":
      return "Someone it saw is caught.";
    case "auditedShakenDirty":
      return "A visitor of a room it audited is caught.";
    case "checkedShakenDirty":
      return "A player it checked is caught.";
    case "targetShakenDirty":
      return "Its target is caught.";
    case "wonDirtyShakedown":
      return "It votes to catch a cheater who is then caught.";
    case "cancelledClean":
      return "It saved an innocent (and it gets the power back).";
    case "blessedShakenClean":
      return "A blessing pays out.";
    case "allInStreak":
      return `It hands in everything ${BAGMAN_STREAK} rounds running.`;
    case "coolingRounds":
      return `Every ${CLEANER_REWARD_EVERY === 2 ? "2nd" : `${CLEANER_REWARD_EVERY}th`} ${p?.kind === "cleaner" ? roomName(p.room) : "cooling"} round.`;
    case "raidStopped":
      return "It stops a raid.";
    case "loopHidPocketer":
      return "A loop hid someone who pocketed.";
    case "forgedShakenClean":
      return "Someone it framed is shaken down clean.";
    case "heatReached":
      return `Heat reaches ${p?.kind === "getaway" ? p.tokenHeat : "its mark"}.`;
    case "safeReached":
      return `The safe reaches ${p?.kind === "fenceSafe" ? p.tokenSafe : "its mark"}.`;
    case "stolenVoteDecided":
      return "A vote it stole decides a shakedown.";
    case "tipOffLanded":
      return "Each tip-off.";
    case "firstTake":
      return "Its first take.";
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

export function roleInfo(id: RoleId, roles: Readonly<Record<RoleId, RoleDef>> = ROLES, job: JobDef = BANK_JOB): RoleInfo {
  const def = roles[id];
  if (!def) return { id, name: id, tag: "teamPlayer", tagLabel: TAG_LABEL.teamPlayer, star: false, power: "", earns: null, howYouWin: howYouWin([]), minPlayers: null };
  const reward = def.rewards?.[0];
  return {
    id,
    name: def.name,
    tag: def.tag,
    tagLabel: TAG_LABEL[def.tag],
    star: def.winsOn.length > 0,
    power: powerText(def.power, job, def),
    earns: reward ? `${reward.count === 1 ? "A token" : `${reward.count} tokens`} when: ${earnsText(reward.on, def).replace(/^./, (c) => c.toLowerCase())}` : null,
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

// ---------------------------------------------------------------- target bar

export interface TargetBar {
  readonly haul: number;
  readonly target: number;
  /** Meeting 1, 2 or 3 (final). */
  readonly meeting: 1 | 2 | 3;
  readonly final: boolean;
  /** "Haul 40 / 63 needed by the next meeting". */
  readonly text: string;
  /** What missing it costs: "+15 Heat if missed" or "the heist fails if missed". */
  readonly ifMissed: string;
}

/** The Haul target as a progress bar to the next meeting. extension.md "What the app works out for you" */
export function targetBar(view: PlayerView): TargetBar {
  const t = nextTarget(view);
  const job = jobOf(view);
  return {
    haul: view.haul,
    target: t.target,
    meeting: t.act,
    final: t.final,
    text: `Haul ${view.haul} / ${t.target} needed by ${t.final ? "the final meeting" : "the next meeting"}`,
    ifMissed: t.final ? "the heist fails if missed" : `+${job.heat.missedCheckpoint} Heat if missed`,
  };
}

// ---------------------------------------------------------------- Heat breakdown

export interface HeatLine {
  readonly label: string;
  readonly value: number;
  readonly kind: "base" | "room" | "event" | "police" | "missed";
}

export interface HeatRound {
  readonly round: number;
  readonly lines: readonly HeatLine[];
  readonly total: number;
  /** "+4 every round, +10 Vault, −5 Rooftop, +4 police activity". */
  readonly text: string;
}

const ledgerEvents = (view: Pick<PlayerView, "ledger">): GameEvent[] => view.ledger.map((x) => x.event);

/**
 * One round's Heat change by part: the baseline, each room, the event card,
 * police activity (never its source) and a missed target. extension.md
 * "What the app works out for you", Build notes "Police activity".
 */
export function heatRound(view: Pick<PlayerView, "ledger">, round: number): HeatRound | null {
  const log = ledgerEvents(view);
  const b = heatBreakdown(log, round);
  if (!b) return null;
  const card = log.find((e) => e.type === "eventFlipped" && e.round === round);
  const lines: HeatLine[] = [];
  if (b.base !== 0) lines.push({ label: "every round", value: b.base, kind: "base" });
  for (const [room, v] of Object.entries(b.rooms)) if (v !== 0) lines.push({ label: roomName(room), value: v, kind: "room" });
  if (b.events !== 0) lines.push({ label: card?.type === "eventFlipped" ? cardName(card.card) : "event card", value: b.events, kind: "event" });
  for (const v of b.police) lines.push({ label: "police activity", value: v, kind: "police" });
  if (b.missedTarget !== 0) lines.push({ label: "missed target", value: b.missedTarget, kind: "missed" });
  const total = lines.reduce((s, l) => s + l.value, 0);
  return { round, lines, total, text: lines.length === 0 ? "no change" : lines.map((l) => `${signed(l.value)} ${l.label}`).join(", ") };
}

/** Every round with a Heat breakdown, newest first. */
export function heatRounds(view: Pick<PlayerView, "ledger" | "round">): HeatRound[] {
  const out: HeatRound[] = [];
  for (let r = view.round; r >= 1; r--) {
    const h = heatRound(view, r);
    if (h) out.push(h);
  }
  return out;
}

export const signedText = signed;

// ---------------------------------------------------------------- gap box

export interface GapInfo {
  readonly round: number;
  readonly posted: number;
  readonly crew: number;
  /** "Alibis say +14, the Haul grew 9: 5 unaccounted for." */
  readonly text: string;
  readonly unaccounted: number;
}

/** The alibi arithmetic for the latest resolved round (event effects included by the engine). extension.md */
export function gapInfo(view: PlayerView): GapInfo | null {
  const g = view.gap;
  if (!g) return null;
  const crew = crewSize(view);
  const say = `Alibis say ${signed(g.alibis)}, the Haul grew ${g.haulGrowth}`;
  const text =
    g.posted === 0
      ? `No alibis yet for round ${g.round}; the Haul grew ${g.haulGrowth}.`
      : g.unaccounted > 0
        ? `${say}: ${g.unaccounted} unaccounted for.`
        : g.unaccounted < 0
          ? `${say}: ${-g.unaccounted} more than the alibis claim.`
          : `${say}: it adds up.`;
  return { round: g.round, posted: g.posted, crew, text, unaccounted: g.unaccounted };
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
  /** This game has a shop (not in Starter/Quick). */
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
    ({ event: e }) => e.type === "perkUsed" && e.player === view.me.id && e.round === view.round && e.perk.kind !== "shield" && e.perk.kind !== "emergency",
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
  if (own.has("recharge") && (view.me.roleState.usedThisAct > 0 || view.me.roleState.usedThisGame > 0) && rolesOf(view)[view.me.role]?.power.kind !== "fenceSafe") {
    out.push({ kind: "recharge" });
  }
  if (own.has("rig") && view.round < 3 * ROUNDS_PER_ACT && setupOf(view)?.eventsEnabled !== false && !out.some((u) => u.kind === "rigPick")) out.push({ kind: "rig" });
  return out;
}

// ---------------------------------------------------------------- end of game

/** How the game ended, in one line, and why each winner won. extension.md "Winning and losing" */
export function endingText(outcome: { readonly result: "success" } | { readonly result: "failed"; readonly reason: FailureReason }): { title: string; badge: string; loss: boolean } {
  if (outcome.result === "success") return { title: "Final target met with Heat below 100", badge: "Biggest stash", loss: false };
  return outcome.reason === "heat"
    ? { title: "The cops raided: Heat hit 100", badge: "Wins on a raid", loss: true }
    : { title: "The final target was missed", badge: "Wins on a missed target", loss: true };
}
