// Crew roles of role deck v2 (docs/roles-v2.md §2, steps R2a and R2b): the
// Auditor's, Detective's and Priest's powers, the Fixer's save, the Muscle's
// and Priest's shakedown hooks, and the perk rewards that crew roles earn. design §8, §8.3
//
// The three powers are used with `useAbility` and answered with a private
// `abilityResolved`. Rewards are private `perkGranted` events, emitted where
// their trigger happens: after a round resolves (`roundRewards`), after a
// checkpoint is made (`checkpointRewards`), after a shakedown
// (`dirtyShakedownRewards`, `muscleCancelEvents`, `blessingEvents`) and when
// a raid is stopped (`stopRaid`).
import { CLEANER_REWARD_EVERY, type PerkTrigger, type RolePower } from "@skimjob/content";
import type { ActNumber, GameEvent, GameState, PlayerId, PlayerState } from "./types";
import { PUBLIC, privateTo } from "./types";
import { jobFor, powerOf, roleDefIn, rolesFor } from "./overrides";
import { actOfRound, isLastRoundOfAct } from "./acts";
import { isObject, show } from "./check";
import { holdsDirty } from "./accomplices";

type Result = GameEvent[] | string;

/** The current act's clean threshold: a stash (with any Fence safe) below it is clean. design §11.3 */
export const cleanThreshold = (state: GameState): number => jobFor(state.config).shakedown.cleanBelowPerAct * actOfRound(Math.max(1, state.round));

/**
 * Auditor (v2 §2): once per act, the latest resolved round's shortfall for
 * one room in play: what its visitors pocketed (0 if none, or if nobody was there).
 */
function audit(state: GameState, player: PlayerState, perAct: number, raw: Record<string, unknown>): Result {
  if (player.roleState.usedThisAct >= perAct) return "you have already audited a room this act";
  const round = state.resolvedRound;
  if (round === 0) return "no round has resolved yet";
  // PR #26 review: the act's last round is still the latest one as the next act starts; one audit of it is enough.
  if (state.log.some((e) => e.type === "abilityResolved" && e.player === player.id && e.ability.kind === "audit" && e.ability.round === round)) {
    return `you have already audited round ${round}`;
  }
  if (typeof raw.room !== "string" || !state.rooms.includes(raw.room)) return "audit a room in play";
  const room = raw.room;
  let shortfall = 0;
  for (const e of state.log) if (e.type === "lootSplit" && e.round === round && e.room === room) shortfall += e.toStash;
  return [{ type: "abilityResolved", visibility: privateTo(player.id), player: player.id, round: state.round, ability: { kind: "audit", round, room, shortfall } }];
}

/** Detective (v2 §2): once per act, whether another player's stash is at or above the clean threshold right now. */
function checkStash(state: GameState, player: PlayerState, perAct: number, raw: Record<string, unknown>): Result {
  if (player.roleState.usedThisAct >= perAct) return "you have already checked a stash this act";
  const target = raw.target;
  if (typeof target !== "string" || !Object.hasOwn(state.players, target)) return `unknown player ${show(target)}`;
  if (target === player.id) return "check another player's stash";
  // PR #26 review: a check during the window would be a sure Shield (the shakedown is public, so this refusal tells nothing).
  if (state.pendingShakedown?.target === target) return "that player's shakedown is already pending";
  const threshold = cleanThreshold(state);
  return [
    {
      type: "abilityResolved",
      visibility: privateTo(player.id),
      player: player.id,
      round: state.round,
      ability: { kind: "checkStash", target, threshold, dirty: holdsDirty(state, target, threshold) },
    },
  ];
}

/** The act of each meeting, from the public `meetingOpened`s. */
const meetingActs = (state: GameState): Map<string, ActNumber> =>
  new Map(state.log.flatMap((e) => (e.type === "meetingOpened" ? [[e.meetingId, e.act] as const] : [])));

/** Priests (by player id) whose blessing for `act` covers `target`, given before now. */
function blessersOf(state: GameState, target: PlayerId, act: ActNumber): PlayerId[] {
  const out: PlayerId[] = [];
  for (const e of state.log) {
    if (e.type === "abilityResolved" && e.ability.kind === "bless" && e.ability.target === target && e.ability.act === act) out.push(e.player);
  }
  return out;
}

/** Whether a player `priest` blessed in `act` was later shaken down dirty in a meeting of that act. */
function blessedWentDirty(state: GameState, priest: PlayerId, act: number): boolean {
  const acts = meetingActs(state);
  return state.log.some(
    (e, i) =>
      e.type === "abilityResolved" &&
      e.player === priest &&
      e.ability.kind === "bless" &&
      e.ability.act === act &&
      state.log.slice(i).some((x) => x.type === "shakedownResolved" && !x.clean && x.target === (e.ability as { target: PlayerId }).target && acts.get(x.meetingId) === act),
  );
}

/**
 * Priest (v2 §2): once per act, bless another player for the current act.
 * Refused for a player whose shakedown is already pending, and for the whole
 * act after a blessed player was shaken down dirty in the act before.
 */
function bless(state: GameState, player: PlayerState, perAct: number, raw: Record<string, unknown>): Result {
  if (player.roleState.usedThisAct >= perAct) return "you have already blessed someone this act";
  const target = raw.target;
  if (typeof target !== "string" || !Object.hasOwn(state.players, target)) return `unknown player ${show(target)}`;
  if (target === player.id) return "bless another player";
  if (state.pendingShakedown?.target === target) return "that player's shakedown is already pending";
  const act = actOfRound(Math.max(1, state.round));
  if (blessedWentDirty(state, player.id, act - 1)) return "your last blessing was caught dirty: no blessing this act";
  return [{ type: "abilityResolved", visibility: privateTo(player.id), player: player.id, round: state.round, ability: { kind: "bless", target, act } }];
}

/** `useAbility` with the Auditor's, Detective's or Priest's power, or null if `power` is none of them. */
export function useCrewPower(state: GameState, player: PlayerState, power: RolePower, raw: unknown): Result | null {
  if (!isObject(raw) || raw.kind !== power.kind) return null;
  if (power.kind === "audit") return audit(state, player, power.perAct, raw);
  if (power.kind === "checkStash") return checkStash(state, player, power.perAct, raw);
  if (power.kind === "bless") return bless(state, player, power.perAct, raw);
  return null;
}

/** `count` × `perk` for each player whose role has a reward on `trigger` and for whom `earned` holds. */
export function grantRewards(state: GameState, trigger: PerkTrigger, earned: (player: PlayerState) => boolean): GameEvent[] {
  const roles = rolesFor(state.config);
  const out: GameEvent[] = [];
  for (const id of state.playerOrder) {
    const player = state.players[id] as PlayerState;
    for (const reward of roleDefIn(roles, player.role)?.rewards ?? []) {
      if (reward.on !== trigger || !earned(player)) continue;
      for (let i = 0; i < reward.count; i++) out.push({ type: "perkGranted", visibility: privateTo(id), player: id, perk: reward.perk });
    }
  }
  return out;
}

/** design §8.3 (v2 §2): an Act 1 or 2 checkpoint was made. Rookie → Tail, Inside Man → Peek, Mastermind → Rig. */
export const checkpointRewards = (state: GameState): GameEvent[] => grantRewards(state, "checkpointMade", () => true);

/**
 * design §8.3 (v2 §2): `target` was just shaken down dirty. Lookout → Peek if
 * its power saw them; Auditor → Ballot if they visited a room it audited, in
 * that round; Detective → Shield if it checked them. Earlier this game, by
 * this player (provisional). Smooth Talker → an Emergency if its last ballot
 * in `meetingId` was for this shakedown. Nobody is rewarded for their own shakedown.
 */
export function dirtyShakedownRewards(state: GameState, target: PlayerId, meetingId: string): GameEvent[] {
  // Each voter's last ballot in this meeting (a later one replaces an earlier, sealed votes included).
  const ballots = new Map<PlayerId, string>();
  for (const e of state.log) if (e.type === "voteCast" && e.meetingId === meetingId) ballots.set(e.player, e.vote.kind === "shakedown" ? e.vote.target : "");
  const mine = (player: PlayerState) => state.log.filter((e) => "player" in e && e.player === player.id && e.player !== target);
  const roomOf = (round: number): string | undefined => {
    const split = state.log.find((e) => e.type === "lootSplit" && e.player === target && e.round === round);
    return split?.type === "lootSplit" ? split.room : undefined;
  };
  return [
    ...grantRewards(state, "watchedShakenDirty", (p) => mine(p).some((e) => e.type === "roomWatched" && e.source === "lookout" && e.seen.includes(target))),
    ...grantRewards(state, "auditedShakenDirty", (p) =>
      mine(p).some((e) => e.type === "abilityResolved" && e.ability.kind === "audit" && roomOf(e.ability.round) === e.ability.room),
    ),
    ...grantRewards(state, "checkedShakenDirty", (p) => mine(p).some((e) => e.type === "abilityResolved" && e.ability.kind === "checkStash" && e.ability.target === target)),
    ...grantRewards(state, "wonDirtyShakedown", (p) => p.id !== target && ballots.get(p.id) === target),
  ];
}

/** Whether `target` holds at least `act`'s clean threshold (stash plus any Fence safe), as the clean check counts it. design §11.3 */
const dirtyAt = (state: GameState, target: PlayerId, act: number): boolean => holdsDirty(state, target, jobFor(state.config).shakedown.cleanBelowPerAct * act);

/**
 * Muscle (v2 §2), as its cancel of `target`'s shakedown takes effect: a
 * target who wasn't clean gets the Muscle named in public (`muscleNamed`); a
 * clean one earns it a Recharge (never for its own shakedown). No
 * compensation is paid either way: nothing was taken.
 */
export function muscleCancelEvents(state: GameState, meetingId: string, target: PlayerId, act: number): GameEvent[] {
  const cancel = state.log.find((e) => e.type === "abilityResolved" && e.ability.kind === "cancelShakedown" && e.ability.meetingId === meetingId);
  if (cancel?.type !== "abilityResolved") return [];
  const muscle = cancel.player;
  if (dirtyAt(state, target, act)) return [{ type: "muscleNamed", visibility: PUBLIC, meetingId, player: muscle, target }];
  return grantRewards(state, "cancelledClean", (p) => p.id === muscle && muscle !== target);
}

/**
 * Priest (v2 §2): `target` was shaken down clean in a meeting of `act`. If a
 * Priest blessed them for that act, the bank pays the compensation
 * (`blessingPaid` puts it back into the Haul) and each such Priest earns a Ballot.
 */
export function blessingEvents(state: GameState, meetingId: string, target: PlayerId, act: ActNumber, compensation: number): GameEvent[] {
  const priests = blessersOf(state, target, act);
  if (priests.length === 0) return [];
  const paid: GameEvent[] = compensation > 0 ? [{ type: "blessingPaid", visibility: PUBLIC, meetingId, target, amount: compensation }] : [];
  return [...paid, ...grantRewards(state, "blessedShakenClean", (p) => priests.includes(p.id))];
}

/**
 * design §8.3 (v2 §2), after round `round`'s splits (`fresh`: this round's
 * events so far, not yet in `now.log`): a Bagman who pocketed nothing in every
 * round of the act earns an Alibi as the act's last round resolves; a Cleaner
 * earns a +Vote on every `CLEANER_REWARD_EVERY`th round it spends in its cooling room.
 */
export function roundRewards(now: GameState, fresh: readonly GameEvent[], round: number): GameEvent[] {
  const splits = (p: PlayerState) => [...now.log, ...fresh].filter((e) => e.type === "lootSplit" && e.player === p.id);
  const act = actOfRound(round);
  const allIn = (p: PlayerState) => {
    const inAct = splits(p).filter((e) => e.type === "lootSplit" && actOfRound(e.round) === act);
    return isLastRoundOfAct(round) && inAct.length > 0 && inAct.every((e) => e.type === "lootSplit" && e.toStash === 0);
  };
  const cooled = (p: PlayerState) => {
    const power = powerOf(now.config, p.role);
    if (power.kind !== "cleaner") return false;
    const visits = splits(p).filter((e) => e.type === "lootSplit" && e.room === power.room);
    return visits.at(-1)?.type === "lootSplit" && (visits.at(-1) as { round: number }).round === round && visits.length % CLEANER_REWARD_EVERY === 0;
  };
  return [...grantRewards(now, "actAllIn", allIn), ...grantRewards(now, "coolingRounds", cooled)];
}

/**
 * Fixer (v2 §2): Heat has reached the max in `round`. The first Fixer in seat
 * order with its once-per-game save left stops the raid: Heat goes to its
 * `stopAt` (public `raidStopped`, without a name), it loses `lossShare` of its
 * stash (rounded, halves up; private) and earns a Shield. [] if there is none.
 */
export function stopRaid(now: GameState, round: number): GameEvent[] {
  for (const id of now.playerOrder) {
    const player = now.players[id] as PlayerState;
    const power = powerOf(now.config, player.role);
    if (power.kind !== "fixer" || player.roleState.usedThisGame >= 1) continue;
    const lost = Math.min(player.stash, Math.round(player.stash * power.lossShare));
    return [
      { type: "abilityResolved", visibility: privateTo(id), player: id, round, ability: { kind: "fixer", lost } },
      { type: "raidStopped", visibility: PUBLIC, round, heat: Math.min(power.stopAt, jobFor(now.config).heat.max - 1) },
      ...grantRewards(now, "raidStopped", (p) => p.id === id),
    ];
  }
  return [];
}
