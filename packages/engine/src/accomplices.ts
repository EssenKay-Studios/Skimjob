// Accomplices of role deck v2 (docs/roles-v2.md §2, step R3a) and what the
// dark side learns about itself in play: the Hacker is told a saboteur at the
// deal, the Fence learns one once its safe is big enough, the Getaway Driver
// and the saboteurs learn each other once Heat runs high, and each Mole
// tip-off names one accomplice. All of it is a private `alliesLearned`
// (folded into `roleState.allies`). The Getaway Driver's Heat and the
// Hacker's Peek are in round.ts. design §7, §8, §8.1
import type { Faction, RoleId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId, PlayerState, RngState } from "./types";
import { privateTo } from "./types";
import { factionIn, powerOf, roleDefIn, rolesFor } from "./overrides";
import { shuffle } from "./rng";
import type { Draw } from "./handle";

/** Players whose role (as it is now) is of `faction`, in seat order. */
export const playersOf = (state: GameState, faction: Faction): PlayerId[] =>
  state.playerOrder.filter((id) => factionIn(rolesFor(state.config), (state.players[id] as PlayerState).role) === faction);

const learned = (player: PlayerId, allies: readonly PlayerId[], via: "deal" | "fence" | "getaway" | "tipOff"): GameEvent => ({
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
 * that many saboteurs, at random, at the deal. No draws when none is dealt.
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
  return { value: events, rng };
}

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
    if (power.kind === "fenceSafe" && player.safe >= power.revealSafe && !hasLearned(now, id, "fence")) {
      const left = unknown(player, "saboteur");
      if (left.length > 0) events.push(learned(id, [draw.pick(left)], "fence"));
    }
  }
  return [...events, ...getawayReveal(now)];
}
