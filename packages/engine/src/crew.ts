// Powers used with `useAbility` outside a move (docs/roles-v2.md §2): the
// Auditor's, Detective's and Priest's, and the Mole's tip-off; the Fixer's
// save, the Muscle's and Priest's shakedown hooks, and every role's tokens.
// design §8, §8.3; extension.md "Roles", "Tokens and the perk shop"
//
// The powers are answered with a private `abilityResolved`. Every reward is one
// private `tokenEarned`, emitted where its trigger happens: after a round
// resolves (`roundRewards`), after a checkpoint is made (`checkpointRewards`),
// after a shakedown (`dirtyShakedownRewards`, `muscleCancelEvents`,
// `blessingEvents`), when a raid is stopped (`stopRaid`), when Heat first
// reaches the Getaway Driver's level (`heatTokens`), and when a tip-off lands (police.ts).
import { BAGMAN_STREAK, CLEANER_REWARD_EVERY, type RolePower, type TokenTrigger } from "@skimjob/content";
import type { ActNumber, GameEvent, GameState, PlayerId, PlayerState } from "./types";
import { PUBLIC, privateTo } from "./types";
import { jobFor, powerOf, roleDefIn, rolesFor } from "./overrides";
import { actOfRound } from "./acts";
import { isObject, show } from "./check";
import { holdsDirty } from "./accomplices";

type Result = GameEvent[] | string;

/** The clean line: a stash (with any Fence safe) below it is clean; the Detective's "dirty" line too (owner ruling 3). extension.md "Shakedowns (fixed numbers)" */
export const cleanThreshold = (state: GameState): number => jobFor(state.config).shakedown.cleanBelow;

/**
 * Auditor (v2 §2): once per act, the latest resolved round's shortfall for
 * one room in play: what its visitors pocketed (0 if none, or if nobody was there).
 */
function audit(state: GameState, player: PlayerState, perAct: number, raw: Record<string, unknown>): Result {
  if (player.roleState.usedThisAct >= perAct) return "you have already audited a room since the last meeting";
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
  if (player.roleState.usedThisAct >= perAct) return "you have already checked a stash since the last meeting";
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
  if (player.roleState.usedThisAct >= perAct) return "you have already blessed someone since the last meeting";
  const target = raw.target;
  if (typeof target !== "string" || !Object.hasOwn(state.players, target)) return `unknown player ${show(target)}`;
  if (target === player.id) return "bless another player";
  if (state.pendingShakedown?.target === target) return "that player's shakedown is already pending";
  const act = actOfRound(Math.max(1, state.round));
  if (blessedWentDirty(state, player.id, act - 1)) return "your last blessing was caught dirty: no blessing until the next meeting";
  return [{ type: "abilityResolved", visibility: privateTo(player.id), player: player.id, round: state.round, ability: { kind: "bless", target, act } }];
}

/**
 * Mole: once between meetings, any time, tip off the cops. The use counts at
 * once and joins the police queue (folded); it lands at the next free hidden
 * police moment (police.ts). extension.md "Police activity"
 */
function tipOff(state: GameState, player: PlayerState, perAct: number, perGame: number): Result {
  if (!state.police) return "there is no police activity in this game";
  // extension.md owner ruling 4: at most 3 a game, even with Recharge.
  if ((state.police.tipOffs[player.id] ?? 0) >= perGame) return `you have already tipped off the cops ${perGame} times this game`;
  if (player.roleState.usedThisAct >= perAct) return "you have already tipped off the cops since the last meeting";
  return [{ type: "abilityResolved", visibility: privateTo(player.id), player: player.id, round: state.round, ability: { kind: "tipOff" } }];
}

/** `useAbility` with the Auditor's, Detective's, Priest's or Mole's power, or null if `power` is none of them. */
export function useCrewPower(state: GameState, player: PlayerState, power: RolePower, raw: unknown): Result | null {
  if (!isObject(raw) || raw.kind !== power.kind) return null;
  if (power.kind === "tipOff") return tipOff(state, player, power.perAct, power.perGame);
  if (power.kind === "audit") return audit(state, player, power.perAct, raw);
  if (power.kind === "checkStash") return checkStash(state, player, power.perAct, raw);
  if (power.kind === "bless") return bless(state, player, power.perAct, raw);
  return null;
}

/**
 * `count` tokens (one per `tokenEarned`) for each player whose role has a
 * reward on `trigger` and for whom `earned` holds. Nothing in starter mode
 * (Quick and first games have no shop). extension.md "Tokens and the perk shop", gap-fills
 */
export function grantRewards(state: GameState, trigger: TokenTrigger, earned: (player: PlayerState) => boolean): GameEvent[] {
  if (state.config.starterMode) return [];
  const roles = rolesFor(state.config);
  const out: GameEvent[] = [];
  for (const id of state.playerOrder) {
    const player = state.players[id] as PlayerState;
    for (const reward of roleDefIn(roles, player.role)?.rewards ?? []) {
      if (reward.on !== trigger || !earned(player)) continue;
      for (let i = 0; i < reward.count; i++) out.push({ type: "tokenEarned", visibility: privateTo(id), player: id, trigger });
    }
  }
  return out;
}

/** Whether `player` already earned a token for `trigger` (once-per-game triggers). */
const earnedBefore = (state: GameState, player: PlayerId, trigger: TokenTrigger): boolean =>
  state.log.some((e) => e.type === "tokenEarned" && e.player === player && e.trigger === trigger);

/**
 * Getaway Driver (extension.md gap-fills): its token the first time Heat
 * reaches its `tokenHeat`, at any moment (police activity included); once per
 * game. Read after anything that raises Heat.
 */
export const heatTokens = (now: GameState): GameEvent[] =>
  grantRewards(now, "heatReached", (p) => {
    const power = powerOf(now.config, p.role);
    return power.kind === "getaway" && now.heat >= power.tokenHeat && !earnedBefore(now, p.id, "heatReached");
  });

/** extension.md gap-fills: the target was met at meeting 1 or 2. Rookie, Inside Man and Mastermind earn a token. */
export const checkpointRewards = (state: GameState): GameEvent[] => grantRewards(state, "checkpointMade", () => true);

/**
 * extension.md "Roles": `target` was just caught (shaken down dirty). A token
 * for: the Lookout if its power saw them; the Auditor if they visited a room
 * it audited, in that round; the Detective if it checked them (earlier this
 * game, by this player, provisional); the Snitch if they are its target; the
 * Smooth Talker if its last ballot in `meetingId` was for them. Nobody earns
 * one for their own shakedown.
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
    ...grantRewards(state, "targetShakenDirty", (p) => p.id !== target && p.roleState.target === target),
    ...grantRewards(state, "wonDirtyShakedown", (p) => p.id !== target && ballots.get(p.id) === target),
  ];
}

/**
 * Muscle (v2 §2), as its cancel of `target`'s shakedown takes effect: a
 * target who wasn't clean gets the Muscle named in public (`muscleNamed`); a
 * clean one earns it a token and its power back (owner ruling 6; the fold of
 * `tokenEarned` gives the use back), never for its own shakedown. No
 * compensation is paid either way: nothing was taken.
 */
export function muscleCancelEvents(state: GameState, meetingId: string, target: PlayerId): GameEvent[] {
  const cancel = state.log.find((e) => e.type === "abilityResolved" && e.ability.kind === "cancelShakedown" && e.ability.meetingId === meetingId);
  if (cancel?.type !== "abilityResolved") return [];
  const muscle = cancel.player;
  if (holdsDirty(state, target, cleanThreshold(state))) return [{ type: "muscleNamed", visibility: PUBLIC, meetingId, player: muscle, target }];
  return grantRewards(state, "cancelledClean", (p) => p.id === muscle && muscle !== target);
}

/**
 * Priest (v2 §2): `target` was shaken down clean in a meeting of `act`. If a
 * Priest blessed them for that act, the bank pays the compensation
 * (`blessingPaid` puts it back into the Haul) and each such Priest earns a token.
 */
export function blessingEvents(state: GameState, meetingId: string, target: PlayerId, act: ActNumber, compensation: number): GameEvent[] {
  const priests = blessersOf(state, target, act);
  if (priests.length === 0) return [];
  const paid: GameEvent[] = compensation > 0 ? [{ type: "blessingPaid", visibility: PUBLIC, meetingId, target, amount: compensation }] : [];
  return [...paid, ...grantRewards(state, "blessedShakenClean", (p) => priests.includes(p.id))];
}

/**
 * extension.md "Roles", after round `round` resolves (`now` has its events
 * folded): a Bagman earns a token for every
 * `BAGMAN_STREAK` rounds running in which it handed everything in (meetings
 * don't break the run; it restarts after each token); a Cleaner on every
 * `CLEANER_REWARD_EVERY`th round it spends in its cooling room; a Fence the
 * first time its safe holds `tokenSafe`.
 */
export function roundRewards(now: GameState, round: number): GameEvent[] {
  const splits = (p: PlayerState) => now.log.flatMap((e) => (e.type === "lootSplit" && e.player === p.id ? [e] : []));
  const streak = (p: PlayerState) => {
    let run = 0;
    let earned = false;
    for (const e of splits(p)) {
      run = e.toStash === 0 ? run + 1 : 0;
      earned = run === BAGMAN_STREAK;
      if (earned) run = 0;
    }
    return earned && splits(p).at(-1)?.round === round;
  };
  const cooled = (p: PlayerState) => {
    const power = powerOf(now.config, p.role);
    if (power.kind !== "cleaner") return false;
    const visits = splits(p).filter((e) => e.room === power.room);
    return visits.at(-1)?.round === round && visits.length % CLEANER_REWARD_EVERY === 0;
  };
  const safe = (p: PlayerState) => {
    const power = powerOf(now.config, p.role);
    return power.kind === "fenceSafe" && p.safe >= power.tokenSafe && !earnedBefore(now, p.id, "safeReached");
  };
  return [...grantRewards(now, "allInStreak", streak), ...grantRewards(now, "coolingRounds", cooled), ...grantRewards(now, "safeReached", safe)];
}

/**
 * Fixer (v2 §2): Heat has reached the max in `round`. The first Fixer in seat
 * order with its once-per-game save left stops the raid: Heat goes to its
 * `stopAt` (public `raidStopped`, without a name), it loses `lossShare` of its
 * stash (rounded, halves up; private) and earns a token. [] if there is none.
 * It stops any raid, at any moment (extension.md gap-fills "Fixer").
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
