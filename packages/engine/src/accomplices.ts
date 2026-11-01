// Accomplices of role deck v2 (docs/roles-v2.md §2, step R3a) and what the
// dark side learns about itself in play: the Hacker is told a saboteur at the
// deal, the Fence learns one once its safe is big enough, the Getaway Driver
// and the saboteurs learn each other once Heat runs high, and each Mole
// tip-off names one accomplice. All of it is a private `alliesLearned`
// (folded into `roleState.allies`). The Getaway Driver's Heat and the
// Hacker's Peek are in round.ts. design §7, §8, §8.1
//
// R3b: the saboteurs are told the Forger at the deal, a Blackmailer that
// guesses a saboteur and that saboteur learn each other, and an Embezzler's
// first take names one accomplice. The log-derived rules of R3b live here too:
// the Blackmailer's stolen votes, the Embezzler's "always dirty" stash and the
// players a Forger planted.
import type { Faction, RoleId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId, PlayerState, RngState } from "./types";
import { privateTo } from "./types";
import { factionIn, powerOf, roleDefIn, rolesFor } from "./overrides";
import { shuffle } from "./rng";
import type { Draw } from "./handle";

/** Players whose role (as it is now) is of `faction`, in seat order. */
export const playersOf = (state: GameState, faction: Faction): PlayerId[] =>
  state.playerOrder.filter((id) => factionIn(rolesFor(state.config), (state.players[id] as PlayerState).role) === faction);

const learned = (player: PlayerId, allies: readonly PlayerId[], via: "deal" | "fence" | "getaway" | "tipOff" | "blackmail" | "embezzle"): GameEvent => ({
  type: "alliesLearned",
  visibility: privateTo(player),
  player,
  allies,
  via,
});

/** Whether `player` has already learned allies this way (each reward comes once per game). */
const hasLearned = (state: GameState, player: PlayerId, via: string): boolean =>
  state.log.some((e) => e.type === "alliesLearned" && e.player === player && e.via === via);

/**
 * design §8.1 (v2 §2): a role with `knowsSaboteurs` (the Hacker: 1) is told
 * that many saboteurs, at random, at the deal; each saboteur is told every
 * player holding a `knownToSaboteurs` role (the Forger). No draws when no
 * saboteur is dealt.
 */
export function dealtKnowledge(config: GameConfig, roles: readonly RoleId[], rng: RngState): { readonly value: GameEvent[]; readonly rng: RngState } {
  const table = rolesFor(config);
  const saboteurs = config.players.filter((_, i) => factionIn(table, roles[i] as RoleId) === "saboteur").map((p) => p.id);
  const events: GameEvent[] = [];
  config.players.forEach((seat, i) => {
    const count = roleDefIn(table, roles[i] as RoleId)?.knowsSaboteurs ?? 0;
    const others = saboteurs.filter((id) => id !== seat.id);
    if (count <= 0 || others.length === 0) return;
    const drawn = shuffle(rng, others);
    rng = drawn.rng;
    events.push(learned(seat.id, drawn.value.slice(0, count), "deal"));
  });
  const known = config.players.filter((_, i) => roleDefIn(table, roles[i] as RoleId)?.knownToSaboteurs === true).map((p) => p.id);
  for (const id of saboteurs) {
    const told = known.filter((k) => k !== id);
    if (told.length > 0) events.push(learned(id, told, "deal"));
  }
  return { value: events, rng };
}

/**
 * Blackmailer (v2 §2): its right guess was a saboteur's role, so each learns
 * the other (once: nothing if both already know).
 */
export function blackmailAllies(state: GameState, blackmailer: PlayerId, target: PlayerId): GameEvent[] {
  if (factionIn(rolesFor(state.config), (state.players[target] as PlayerState).role) !== "saboteur") return [];
  const knows = (a: PlayerId, b: PlayerId) => (state.players[a] as PlayerState).roleState.allies.includes(b);
  return [
    ...(knows(blackmailer, target) ? [] : [learned(blackmailer, [target], "blackmail")]),
    ...(knows(target, blackmailer) ? [] : [learned(target, [blackmailer], "blackmail")]),
  ];
}

/**
 * Blackmailer (v2 §2): the votes stolen at `meetingId`, victim → Blackmailer.
 * A right guess steals the victim's vote at the first meeting that opens
 * after it (meeting ids are unique, so this reads the log).
 */
export function stolenVotes(state: GameState, meetingId: string): Map<PlayerId, PlayerId> {
  const out = new Map<PlayerId, PlayerId>();
  const log = state.log;
  log.forEach((e, i) => {
    if (e.type !== "abilityResolved" || e.ability.kind !== "blackmail" || !e.ability.correct) return;
    const next = log.slice(i + 1).find((x) => x.type === "meetingOpened");
    if (next?.type === "meetingOpened" && next.meetingId === meetingId) out.set(e.ability.target, e.player);
  });
  return out;
}

/** Embezzler (v2 §2): what `player` has taken from the Haul since its last shakedown (that shakedown returned the rest). */
export function heldTake(state: GameState, player: PlayerId): number {
  let take = 0;
  for (const e of state.log) {
    if (e.type === "shakedownResolved" && e.target === player) take = 0;
    if (e.type === "abilityResolved" && e.player === player && e.ability.kind === "embezzle") take += e.ability.amount;
  }
  return take;
}

/**
 * Whether `target` isn't clean at `threshold`: stash plus any Fence safe at or
 * above it (owner answers, 1 Nov), or an Embezzler holding a take (v2 §2: its
 * stash is always dirty). The shakedown, the Detective and the Muscle read this. design §11.3
 */
export function holdsDirty(state: GameState, target: PlayerId, threshold: number): boolean {
  const { stash, safe } = state.players[target] as PlayerState;
  return stash + safe >= threshold || heldTake(state, target) > 0;
}

/** Forger (v2 §2): the players `forger` has planted in a watch feed so far this game. */
export const forgedBy = (state: GameState, forger: PlayerId): PlayerId[] =>
  state.log.flatMap((e) => (e.type === "abilityResolved" && e.player === forger && e.ability.kind === "forge" ? [e.ability.target] : []));

/**
 * Getaway Driver (v2 §2): once Heat is at or above its `revealHeat`, it
 * learns the saboteurs and each of them learns it (once per game per Driver).
 * Read after a round resolves and after a checkpoint's Heat penalty.
 */
export function getawayReveal(now: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  for (const id of now.playerOrder) {
    const power = powerOf(now.config, (now.players[id] as PlayerState).role);
    if (power.kind !== "getaway" || now.heat < power.revealHeat || hasLearned(now, id, "getaway")) continue;
    const saboteurs = playersOf(now, "saboteur").filter((s) => s !== id);
    if (saboteurs.length === 0) continue;
    events.push(learned(id, saboteurs, "getaway"), ...saboteurs.map((s) => learned(s, [id], "getaway")));
  }
  return events;
}

/**
 * After round `round` resolves (`now` has its events folded): each Mole that
 * tipped off this round learns one accomplice it didn't know (v2 §2); a Fence
 * whose safe reached its `revealSafe` learns one saboteur it didn't know (once
 * per game); and the Getaway Driver's reveal. Picks are drawn at random.
 */
export function darkRoundEvents(now: GameState, round: number, draw: Draw): GameEvent[] {
  const events: GameEvent[] = [];
  const unknown = (player: PlayerState, faction: Faction) =>
    playersOf(now, faction).filter((id) => id !== player.id && !player.roleState.allies.includes(id));
  for (const id of now.playerOrder) {
    const player = now.players[id] as PlayerState;
    const power = powerOf(now.config, player.role);
    const tipped = now.log.some((e) => e.type === "abilityResolved" && e.player === id && e.round === round && e.ability.kind === "tipOff");
    if (power.kind === "tipOff" && tipped) {
      const left = unknown(player, "accomplice");
      if (left.length > 0) events.push(learned(id, [draw.pick(left)], "tipOff"));
    }
    // v2 §2: an Embezzler's first take names one accomplice it didn't know.
    const takes = now.log.filter((e) => e.type === "abilityResolved" && e.player === id && e.ability.kind === "embezzle");
    if (power.kind === "embezzle" && takes.length === 1 && takes[0]?.type === "abilityResolved" && takes[0].round === round) {
      const left = unknown(player, "accomplice");
      if (left.length > 0) events.push(learned(id, [draw.pick(left)], "embezzle"));
    }
    if (power.kind === "fenceSafe" && player.safe >= power.revealSafe && !hasLearned(now, id, "fence")) {
      const left = unknown(player, "saboteur");
      if (left.length > 0) events.push(learned(id, [draw.pick(left)], "fence"));
    }
  }
  return [...events, ...getawayReveal(now)];
}
