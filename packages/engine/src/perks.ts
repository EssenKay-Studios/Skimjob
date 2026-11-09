// Perks and the black market: one handler per perk id (design §19.2 seam 4),
// buying a perk with coins from your stash, and Bail's choice. design §12
//
// `buyPerk` buys and uses a perk at once while planning, one per player per
// round: the buyer's private `perkBought` (folded in reduce.ts: the coins leave
// the stash and the game). The public, nameless `perkSold` notices wait for
// planning to close and come out together (`roundSales`), so neither their
// order nor their timing points at a buyer (§18). What a perk
// does then happens where its rule does: Tail, Soft shoes and Plant evidence
// as a round resolves (round.ts), Blackout as the next round starts (deck.ts),
// Check ballot as the next meeting opens, Stamped alibi when the alibi is
// posted (`stampedAlibi`), and Bail when a shakedown passes (meeting.ts).
import { PERK_IDS, PERK_TEXT, type PerkId, type RoomId } from "@skimjob/content";
import type { GameEvent, GameState, PerkUse, PlayerId, PlayerState } from "./types";
import { PUBLIC, privateTo } from "./types";
import { perkCost } from "./overrides";
import { isObject, playerFor, show } from "./check";

type Raw = Record<string, unknown>;

const roomInPlay = (state: GameState, room: unknown): room is RoomId => typeof room === "string" && state.rooms.includes(room);

/** Why `target` isn't another player in the game, or null. design §11.1: no perk targets yourself. */
function notOther(state: GameState, player: PlayerState, target: unknown): string | null {
  if (typeof target !== "string" || !Object.hasOwn(state.players, target)) return `unknown player ${show(target)}`;
  return target === player.id ? "pick another player" : null;
}

/** Each perk's check: the use as bought, or why it is refused. design §12 */
const PERK_HANDLERS: Readonly<Record<PerkId, (state: GameState, player: PlayerState, raw: Raw) => PerkUse | string>> = {
  tail: (state, _player, raw) => (roomInPlay(state, raw.room) ? { kind: "tail", room: raw.room } : "tail a room in play"),
  alibi: () => ({ kind: "alibi" }),
  // design §9.5: ballots are public as they're cast in Open mode, so there is nothing to check.
  ballot: (state, player, raw) =>
    state.config.voteVisibility === "open" ? "ballots are already public in this game" : (notOther(state, player, raw.target) ?? { kind: "ballot", target: raw.target as PlayerId }),
  softShoes: () => ({ kind: "softShoes" }),
  blackout: (state, _player, raw) => (roomInPlay(state, raw.room) ? { kind: "blackout", room: raw.room } : "black out a room in play"),
  bail: (_state, player) => (player.roleState.bail ? "you already hold a Bail" : { kind: "bail" }),
  plantEvidence: (state, player, raw) => {
    const bad = notOther(state, player, raw.target);
    if (bad) return bad;
    return roomInPlay(state, raw.room) ? { kind: "plantEvidence", target: raw.target as PlayerId, room: raw.room } : "plant evidence in a room in play";
  },
};

/** The perks of `kind` bought in `round`, with their buyers, in the order bought. */
export function boughtIn<K extends PerkUse["kind"]>(state: GameState, round: number, kind: K): [PlayerId, Extract<PerkUse, { kind: K }>][] {
  return state.log.flatMap((e) => (e.type === "perkBought" && e.round === round && e.perk.kind === kind ? [[e.player, e.perk as Extract<PerkUse, { kind: K }>]] : []));
}

/**
 * `buyPerk`: one of this game's three perks, while planning, at most one per
 * player per round, paid from the stash as it stood at the start of the round
 * (this round's pocket is only added as it resolves). design §12
 */
export function buyPerk(state: GameState, command: Raw): GameEvent[] | string {
  if (state.phase.kind !== "planning") return "perks are bought while a round is being planned";
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  const raw = command.perk;
  if (!isObject(raw) || typeof raw.kind !== "string") return "perk must be an object with a kind";
  const id = raw.kind as PerkId;
  if (!state.shop.includes(id)) return `perk ${show(raw.kind)} is not on this game's black market`;
  const round = state.round;
  if (state.log.some((e) => e.type === "perkBought" && e.player === player.id && e.round === round)) return "you have already bought a perk this round";
  const cost = perkCost(state.config, id);
  if (player.stash < cost) return `${PERK_TEXT[id]?.name ?? id} costs ${cost} coin${cost === 1 ? "" : "s"}; your stash holds ${player.stash}`;
  const perk = PERK_HANDLERS[id](state, player, raw);
  if (typeof perk === "string") return perk;
  return [{ type: "perkBought", visibility: privateTo(player.id), player: player.id, round, perk, cost }];
}

/**
 * "Someone bought …" for every perk bought in `round`, as planning closes, all
 * together in the black market's order (not the order bought), so the public
 * log can't tie one to its buyer. design §12, §18
 */
export function roundSales(state: GameState, round: number): GameEvent[] {
  const bought = state.log.flatMap((e) => (e.type === "perkBought" && e.round === round ? [e] : []));
  return PERK_IDS.flatMap((id) => bought.filter((e) => e.perk.kind === id).map((e): GameEvent => ({ type: "perkSold", visibility: PUBLIC, round, perk: id, cost: e.cost })));
}

/** Stamped alibi: `player`'s alibi for `round` is stamped "verified" if they bought one that round and it is true. design §12 */
export function stampedAlibi(state: GameState, player: PlayerId, round: number, room: RoomId): GameEvent[] {
  if (!boughtIn(state, round, "alibi").some(([buyer]) => buyer === player)) return [];
  const real = state.log.find((e) => e.type === "coinsGrabbed" && e.player === player && e.round === round);
  return real?.type === "coinsGrabbed" && real.room === room ? [{ type: "alibiVerified", visibility: PUBLIC, player, round, room }] : [];
}

/**
 * `chooseBail`: the target of the shakedown waiting for its Bail choice, holding
 * Bail, chooses to use it or not; the latest choice counts. design §9.6
 */
export function chooseBail(state: GameState, command: Raw): GameEvent[] | string {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  const pending = state.pendingShakedown;
  if (!pending) return "no shakedown is waiting for a Bail choice";
  if (pending.target !== player.id) return "only the shakedown's target can use Bail";
  if (!player.roleState.bail) return "you hold no Bail";
  if (typeof command.use !== "boolean") return "use must be true or false";
  return [{ type: "bailChosen", visibility: privateTo(player.id), player: player.id, meetingId: pending.meetingId, use: command.use }];
}
