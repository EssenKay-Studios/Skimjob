// Property / fuzz tests: random seeded configs driven by random valid and
// invalid command streams, with the engine's invariants checked after every
// step. A safety net for rule changes (docs/testing.md).
//
// fast-check runs with a fixed seed, so CI is deterministic. Fuzz harder
// locally with FC_RUNS=500 (and FC_SEED=<n> to explore other streams); a
// failure prints the seed and a shrunk counterexample to replay.
//
// Invariants (design section in brackets):
//  - handleCommand never throws, and a rejection leaves the state untouched
//    (states are deep-frozen, so any mutation throws). [§17.2]
//  - a command for a seat that isn't in the game is always refused. [§17.2]
//  - loot is conserved: Haul + stashes + safes = loot split from rooms
//    + Snitch payouts − Raid-rumour losses; nothing goes negative. [§5.2, §8, §10, §11.3, §16.1]
//  - Heat is a whole number in 0..max, and the game is over once it hits max. [§7]
//  - the phase machine never sticks: until the game ends, some scheduler
//    deadline is accepted; and every game ends. [§4.1, §11, §17.2]
//  - phase and its companion fields agree (meeting, pendingShakedown). [§17.2]
//  - replay(config, log) rebuilds the state; same seed + commands = same log. [§17.2]
//  - viewFor never leaks: the ledger/case file are exactly what canSee allows,
//    and changing anything hidden from a player leaves their view identical. [§13, §17.2, §11.2]
//  - the deal follows §8.1 (one of each non-Rookie role, Mole count allowed).
//  - the end-of-game ranking matches the final stashes. [§3, §13]
import { isDeepStrictEqual } from "node:util";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FILLER_ROLE, MOLE_ROLE, ROLES, STARTER_ROLES } from "@skimjob/content";
import type { Command, GameConfig, GameEvent, GameState, MoleSetting, PlayerId, PlayerState, VoteVisibility } from "./types";
import { REVEAL, canSee, secretTo } from "./types";
import { createGame, darkSideOdds, rolePoolFor, saboteursFor } from "./setup";
import { isDarkSide, rolesFor } from "./overrides";
import { handleCommand } from "./handle";
import { replay } from "./reduce";
import { viewFor } from "./view";
import { jobFor } from "./overrides";

const RUNS = Number(process.env.FC_RUNS ?? 45);
// Role deck v2 R1 changed the deal's draws, so 20261101's 45 games no longer happened to reach a
// Muscle cancel (coverage below is statistical; seeds 1, 2, 3 and 20261102 all reach it).
const SEED = Number(process.env.FC_SEED ?? 20261102);
const TIMEOUT = 60_000 + RUNS * 1_000;
const ALL_ROLES = Object.keys(ROLES);

// ---------------------------------------------------------------- configs

const VOTES: readonly VoteVisibility[] = ["hiddenThenRevealed", "open", "secret"];
const MOLES: readonly MoleSetting[] = ["off", "maybe", "on"];

const normalConfig = fc
  .record({
    players: fc.integer({ min: 2, max: 12 }),
    vote: fc.constantFrom(...VOTES),
    mole: fc.constantFrom(...MOLES),
    events: fc.boolean(),
    starter: fc.boolean(),
    // design §8.1, §15: absent = unique (the default); false lets roles repeat.
    unique: fc.constantFrom(undefined, true, false),
    seed: fc.string({ minLength: 1, maxLength: 12 }),
  })
  .map(({ players, vote, mole, events, starter, unique, seed }): GameConfig => ({
    seed,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isBot: i % 2 === 1 })),
    job: "bank",
    rolePool: [],
    // Starter mode needs the Mole and events off (validateConfig).
    mole: starter ? "off" : mole,
    eventsEnabled: starter ? false : events,
    voteVisibility: vote,
    starterMode: starter,
    ...(unique === undefined ? {} : { uniqueRoles: unique }),
  }));

/** design §16.1: Duel is exactly 2 players. */
const duelConfig = fc
  .record({ events: fc.boolean(), mole: fc.constantFrom(...MOLES), seed: fc.string({ minLength: 1, maxLength: 12 }) })
  .map(({ events, mole, seed }): GameConfig => ({
    seed,
    players: [
      { id: "p1", name: "P1", isBot: false },
      { id: "p2", name: "P2", isBot: true },
    ],
    job: "bank",
    rolePool: [],
    mole,
    eventsEnabled: events,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    duel: true,
  }));

const configArb = fc.oneof({ arbitrary: normalConfig, weight: 5 }, { arbitrary: duelConfig, weight: 1 });
/** The command stream: each step reads a few numbers from this tape; when it runs out, only deadlines pass. */
const tapeArb = fc.array(fc.nat({ max: 0xffff }), { minLength: 400, maxLength: 4000, size: "max" });

// ---------------------------------------------------------------- the scheduler's deadlines

/** The deadline(s) that would pass next, as runBotGame's stand-in scheduler picks them. */
function nextDeadlines(state: GameState): Command[] {
  const phase = state.phase;
  if (phase.kind === "meeting") return [{ type: "advance", deadline: { kind: "closeMeeting", meetingId: phase.meetingId } }];
  if (phase.kind === "shakedownPending") return [{ type: "advance", deadline: { kind: "resolveShakedown", meetingId: phase.meetingId } }];
  const out: Command[] = [];
  if (state.pendingEmergency && (phase.kind === "planning" || phase.kind === "alibis" || phase.kind === "awaitingMeeting")) {
    out.push({ type: "advance", deadline: { kind: "openMeeting", meetingId: state.pendingEmergency.meetingId } });
  }
  if (phase.kind === "planning") out.push({ type: "advance", deadline: { kind: "round", round: phase.round } });
  // design §5.4: the alibi deadline after each round.
  if (phase.kind === "alibis") out.push({ type: "advance", deadline: { kind: "alibis", round: phase.round } });
  if (phase.kind === "awaitingMeeting") {
    if (state.scheduledMeeting) out.push({ type: "advance", deadline: { kind: "openMeeting", meetingId: state.scheduledMeeting.meetingId } });
    else out.push({ type: "scheduleMeeting", act: phase.act, slot: `server-act-${phase.act}` });
  }
  return out;
}

// ---------------------------------------------------------------- command generators

class Tape {
  private i = 0;
  constructor(private readonly tape: readonly number[]) {}
  get done(): boolean {
    return this.i >= this.tape.length;
  }
  /** 0..n-1 (0 once the tape has run out). */
  int(n: number): number {
    const v = this.tape[this.i++] ?? 0;
    return n <= 1 ? 0 : v % n;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)] as T;
  }
  chance(percent: number): boolean {
    return this.int(100) < percent;
  }
}

const BOGUS_PLAYERS: readonly unknown[] = ["p99", "__proto__", "constructor", "", 3, null, undefined, "P1"];

/** A command a client could plausibly send: mostly valid, sometimes refused by the rules. */
/** Per game: how the crew plays. Hot crews court Heat raids; careful ones hand in and stay cool. */
type Style = "mixed" | "hot" | "careful";

function playerCommand(state: GameState, t: Tape, style: Style): { command: Record<string, unknown>; seated: boolean } {
  const seated = t.chance(92);
  // In a shakedown window, lean on the Muscle (if dealt), so cancels happen. design §8
  const muscle = state.phase.kind === "shakedownPending" ? state.playerOrder.find((id) => state.players[id]?.role === "muscle") : undefined;
  const player = !seated ? t.pick(BOGUS_PLAYERS) : muscle && t.chance(50) ? muscle : t.pick(state.playerOrder);
  const p = seated ? (state.players[player as string] as PlayerState) : undefined;
  const others = state.playerOrder.filter((id) => id !== player);
  const room = (): string => {
    if (style === "hot" && t.chance(60)) return t.pick(["vault", "depositBoxes", "managersOffice"].filter((r) => state.rooms.includes(r)));
    if (style === "careful" && t.chance(60)) return t.pick(["office", "lobby", "tellerLine", "rooftop"].filter((r) => state.rooms.includes(r)));
    return t.chance(95) ? t.pick(state.rooms) : t.pick(["nowhere", "__proto__", "vault"]);
  };
  // Votes lean on one suspect per round, so shakedowns sometimes pass.
  const suspect = state.playerOrder[state.round % state.playerOrder.length];
  const vote = () =>
    t.chance(25) ? { kind: "skip" } : { kind: "shakedown", target: t.chance(60) ? suspect : t.chance(90) ? t.pick(state.playerOrder) : "p99" };
  const base = { player };
  // Mostly what fits the phase, sometimes anything.
  const phase = state.phase.kind;
  const fit = t.chance(70);
  const choice =
    fit && phase === "planning" ? 0 : fit && phase === "alibis" ? 5 : fit && phase === "meeting" ? 9 : fit && phase === "shakedownPending" ? 12 : t.int(14);
  switch (choice) {
    case 0:
    case 1:
    case 2:
    case 3:
    case 4: {
      const r = room();
      const move: Record<string, unknown> = { room: r, pocket: t.chance(style === "careful" ? 90 : 60) ? 0 : t.int(t.chance(80) ? 3 : 8) };
      if (r === "security" || t.chance(5)) move.watch = room();
      if (p && t.chance(50)) {
        const ability = (() => {
          switch (ROLES[p.role]?.power.kind) {
            case "lookout":
              return { kind: "lookout", rooms: [room()] };
            case "fenceSafe":
              return { kind: "fenceSafe", amount: 1 + t.int(6) };
            case "loopCameras":
              return { kind: "loopCameras", room: room() };
            case "blackmail":
              return { kind: "blackmail", target: t.pick(others.length ? others : state.playerOrder), role: t.pick(ALL_ROLES) };
            case "tipOff":
              return { kind: "tipOff" };
            default:
              return t.chance(20) ? { kind: t.pick(["lookout", "fenceSafe", "tipOff", "loopCameras"]) } : undefined;
          }
        })();
        if (ability) move.ability = ability;
      }
      return { command: { ...base, type: "submitMove", move }, seated };
    }
    case 5:
      return { command: { ...base, type: "postAlibi", room: room() }, seated };
    case 6:
      return { command: { ...base, type: "proposeMeeting", slot: `slot-${t.int(3)}` }, seated };
    case 7: {
      const proposalId = state.proposals.length && t.chance(85) ? t.pick(state.proposals).id : `proposal-${t.int(5)}`;
      return { command: { ...base, type: "acceptMeeting", proposalId }, seated };
    }
    case 8:
      return { command: { ...base, type: t.chance(30) ? "callEmergency" : "castVote", vote: vote() }, seated };
    case 9:
    case 10:
      return { command: { ...base, type: "castVote", vote: vote() }, seated };
    case 11:
      return { command: { ...base, type: "sealVote", vote: vote() }, seated };
    case 12:
      return { command: { ...base, type: "useAbility", ability: { kind: "cancelShakedown" } }, seated };
    default:
      return t.chance(50)
        ? { command: { ...base, type: "answerDoubleCross", accept: t.chance(60) }, seated }
        : { command: { ...base, type: "callOut" }, seated };
  }
}

/** Malformed or hostile input: wrong shapes, types, numbers and ids. */
function garbageCommand(state: GameState, t: Tape): unknown {
  const player = t.pick(state.playerOrder);
  const bad: readonly unknown[] = [
    null,
    undefined,
    42,
    "submitMove",
    [],
    {},
    { type: 7 },
    { type: "toString" },
    { type: "__proto__" },
    { type: "constructor", player },
    JSON.parse(`{"type":"submitMove","player":"${player}","move":{"room":"lobby","pocket":0},"__proto__":{"pocket":5}}`),
    { type: "submitMove", player },
    { type: "submitMove", player, move: null },
    { type: "submitMove", player, move: { room: "lobby", pocket: -1 } },
    { type: "submitMove", player, move: { room: "lobby", pocket: 1.5 } },
    { type: "submitMove", player, move: { room: "lobby", pocket: Number.NaN } },
    { type: "submitMove", player, move: { room: "lobby", pocket: "1" } },
    { type: "submitMove", player, move: { room: "vault", pocket: 1e9 } },
    { type: "submitMove", player, move: { room: "lobby", pocket: 0, watch: "vault" } },
    { type: "submitMove", player, move: { room: "security", pocket: 0 } },
    { type: "submitMove", player, move: { room: "lobby", pocket: 0, ability: { kind: "fenceSafe", amount: -3 } } },
    { type: "submitMove", player, move: { room: "lobby", pocket: 0, ability: "tipOff" } },
    { type: "castVote", player, vote: null },
    { type: "castVote", player, vote: { kind: "shakedown" } },
    { type: "castVote", player, vote: { kind: "shakedown", target: player } },
    { type: "sealVote", player, vote: { kind: "maybe" } },
    { type: "postAlibi", player, room: 3 },
    { type: "acceptMeeting", player, proposalId: { id: 1 } },
    { type: "proposeMeeting", player, slot: 9 },
    { type: "useAbility", player, ability: { kind: "tipOff" } },
    { type: "answerDoubleCross", player, accept: "yes" },
    // Wrong or malformed deadlines.
    { type: "advance" },
    { type: "advance", deadline: null },
    { type: "advance", deadline: { kind: "nap" } },
    { type: "advance", deadline: { kind: "round", round: String(state.round) } },
    { type: "advance", deadline: { kind: "round", round: state.round + 1 } },
    { type: "advance", deadline: { kind: "round", round: state.round - 1 } },
    { type: "advance", deadline: { kind: "alibis", round: state.round + 1 } },
    { type: "advance", deadline: { kind: "alibis", round: state.resolvedRound - 1 } },
    { type: "advance", deadline: { kind: "alibis" } },
    { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-9" } },
    { type: "advance", deadline: { kind: "closeMeeting", meetingId: "emergency-nobody" } },
    { type: "advance", deadline: { kind: "resolveShakedown", meetingId: "act-1" } },
    { type: "scheduleMeeting", act: 4, slot: "x" },
    { type: "scheduleMeeting", act: 1, slot: null },
  ];
  return t.pick(bad);
}

// ---------------------------------------------------------------- invariants

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

/** Loot that entered or left the game through these events. */
function lootFlow(events: readonly GameEvent[]): number {
  let n = 0;
  for (const e of events) {
    if (e.type === "lootSplit") n += e.toHaul + e.toStash;
    else if (e.type === "raidRumourHit") n -= e.lost;
    // Role deck v2 R2b: the bank's Bagman bonus and Priest blessing pay in; the Fixer's save pays out.
    else if (e.type === "abilityResolved" && e.ability.kind === "bagman") n += e.ability.bonus;
    else if (e.type === "abilityResolved" && e.ability.kind === "fixer") n -= e.ability.lost;
    else if (e.type === "blessingPaid") n += e.amount;
  }
  return n;
}

function holdings(state: GameState): number {
  return state.haul + Object.values(state.players).reduce((sum, p) => sum + p.stash + p.safe, 0);
}

const isCount = (n: number): boolean => Number.isInteger(n) && n >= 0;

class Failure extends Error {}
function check(ok: boolean, what: string, detail?: unknown): void {
  if (!ok) throw new Failure(`${what}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
}

/** Invariants on one state. `inflow` is the running loot flow. */
function checkState(state: GameState, inflow: number): void {
  const heatMax = jobFor(state.config).heat.max;
  check(Number.isInteger(state.heat) && state.heat >= 0 && state.heat <= heatMax, "Heat within 0..max (design §7)", state.heat);
  if (state.heat >= heatMax) check(state.phase.kind === "ended", "the game is over at max Heat (design §7)", state.phase);
  check(isCount(state.haul), "Haul is a whole number ≥ 0", state.haul);
  for (const p of Object.values(state.players)) check(isCount(p.stash) && isCount(p.safe), "stash and safe are whole numbers ≥ 0", p);
  check(holdings(state) === inflow, "loot conservation (Haul + stashes + safes = loot in − loot out)", { holdings: holdings(state), inflow });
  // Phase companions. design §17.2
  check((state.phase.kind === "meeting") === (state.meeting !== null), "meeting set exactly in the meeting phase", state.phase);
  check((state.phase.kind === "shakedownPending") === (state.pendingShakedown !== null), "pendingShakedown set exactly in its phase", state.phase);
  check(state.round >= 1 && state.round <= 9 && state.resolvedRound <= state.round, "rounds 1..9, resolved ≤ started", [state.round, state.resolvedRound]);
  if (state.phase.kind === "planning") check(state.phase.round === state.round, "planning the latest round");
  // design §5.4: alibis are open exactly in the alibi phase (or in a meeting called during it), for the round just resolved.
  if (state.phase.kind === "alibis") check(state.alibisOpen && state.phase.round === state.resolvedRound && state.phase.round === state.round, "alibi phase for the round just resolved", state.phase);
  if (state.phase.kind === "planning" || state.phase.kind === "awaitingMeeting") check(!state.alibisOpen, "alibis closed outside their phase", state.phase);
  if (state.config.duel) check(state.meeting === null && state.scheduledMeeting === null && state.pendingEmergency === null, "Duel has no meetings (design §16.1)");
}

/** design §8.1 (role deck v2 §3): saboteurs by the setting (the Mole, at most once), then distinct pool roles, then Rookies. */
function checkDeal(state: GameState): void {
  const roles = state.playerOrder.map((id) => (state.players[id] as PlayerState).role);
  const moles = roles.filter((r) => r === MOLE_ROLE).length;
  const allowed = darkSideOdds(roles.length, state.config.mole, state.config.starterMode).map((o) => Math.min(saboteursFor(state.config).length, o.saboteurs));
  check(allowed.includes(moles), "Mole count allowed (design §8.1)", roles);
  check(roles.filter((r) => isDarkSide(rolesFor(state.config), r)).length <= Math.floor(roles.length / 3), "at most ⌊n/3⌋ dark seats (design §8.1)", roles);
  const pool = rolePoolFor(state.config);
  const dealt = roles.filter((r) => r !== MOLE_ROLE && r !== FILLER_ROLE);
  if (state.config.uniqueRoles !== false) check(new Set(dealt).size === dealt.length, "uniqueRoles: each non-Rookie role dealt at most once (design §8.1)", roles);
  check(dealt.every((r) => pool.includes(r)), "roles come from the pool", roles);
  if (state.config.starterMode) check(roles.every((r) => STARTER_ROLES.includes(r)), "starter roles only (design §8.1)", roles);
}

/**
 * The state with everything hidden from `viewer` changed: other players'
 * private fields, moves and ballots, the seed and RNG, the Muscle's cancel,
 * other players' Double-cross offer, and hidden events (dropped, junk added).
 */
function scrub(state: GameState, viewer: PlayerId): GameState {
  const over = state.phase.kind === "ended";
  const other = state.playerOrder.find((id) => id !== viewer) as PlayerId;
  const junk: GameEvent[] = over
    ? [{ type: "voteSealed", visibility: secretTo(other), player: other, vote: { kind: "shakedown", target: viewer } }]
    : [{ type: "rngAdvanced", visibility: REVEAL, words: [9, 9, 9, 9] }];
  const log = state.log.filter((e) => canSee(e.visibility, viewer, over)).flatMap((e) => [e, ...junk]);
  const players: Record<PlayerId, PlayerState> = {};
  for (const [id, p] of Object.entries(state.players)) {
    players[id] =
      id === viewer
        ? p
        : {
            ...p,
            role: p.role === "insideMan" ? "fence" : "insideMan",
            stash: p.stash + 101,
            safe: p.safe + 7,
            roleState: { usedThisAct: 4, usedThisGame: 1, target: viewer, allies: [viewer], perks: ["peek", "shield"], tail: "vault", bonusVotes: 2 },
            totalHandedIn: p.totalHandedIn + 33,
            consecutiveMissedMoves: 5,
            sealedVote: { kind: "shakedown", target: viewer },
          };
  }
  const fakeFor = <T,>(record: Readonly<Record<PlayerId, T>>, fake: T): Record<PlayerId, T> => {
    const out: Record<PlayerId, T> = {};
    for (const id of state.playerOrder) {
      if (id !== viewer) out[id] = fake;
      else if (Object.hasOwn(record, id)) out[id] = record[id] as T;
    }
    return out;
  };
  const offer = state.card?.offer;
  const card =
    state.card && offer && !offer.players.includes(viewer)
      ? { ...state.card, offer: { players: offer.players, accepted: offer.accepted.length ? [] : [...offer.players] } }
      : state.card;
  return {
    ...state,
    config: { ...state.config, seed: "scrubbed" },
    rng: { words: [1, 2, 3, 4] },
    players,
    moves: fakeFor(state.moves, { room: "vault", pocket: 6 }),
    meeting: state.meeting && { ...state.meeting, votes: fakeFor(state.meeting.votes, { kind: "shakedown", target: viewer }) },
    pendingShakedown: state.pendingShakedown && { ...state.pendingShakedown, cancelled: !state.pendingShakedown.cancelled },
    card,
    log,
  };
}

/** design §13, §17.2: what `viewer` gets is exactly what canSee allows. `deep` adds the scrub check. */
function checkView(state: GameState, viewer: PlayerId, deep: boolean): void {
  const over = state.phase.kind === "ended";
  const view = viewFor(state, viewer);
  check(view.ledger.every(({ event }) => event.visibility.kind === "public"), "ledger is public only");
  check(
    view.caseFile.every(({ event }) => (event.visibility.kind === "private" || event.visibility.kind === "secret") && event.visibility.player === viewer),
    "case file is the viewer's own",
  );
  const seen = state.log.filter((e) => canSee(e.visibility, viewer, false));
  const merged = [...view.ledger, ...view.caseFile].sort((a, b) => a.seq - b.seq);
  check(merged.length === seen.length && merged.every((e, i) => e.seq === i), "ledger + case file = canSee, numbered without gaps");
  check(view.players.every((o) => Object.keys(o).sort().join() === "emergencyMeetingUsed,id,isBot,name"), "others show public fields only");
  if (!over) check(view.reveal === null, "no reveal before the end");
  else check(view.reveal !== null && view.reveal.log.every(({ event }) => canSee(event.visibility, viewer, true)), "reveal = canSee after the game");
  if (!deep) return;
  const text = JSON.stringify(view);
  if (!over && state.config.seed.length >= 6) check(!text.includes(JSON.stringify(state.config.seed)), "the seed is reveal-only");
  check(text === JSON.stringify(viewFor(scrub(state, viewer), viewer)), `changing what ${viewer} can't see changes ${viewer}'s view (a leak)`);
}

function checkEnd(state: GameState): void {
  check(state.phase.kind === "ended", "the game ended", state.phase);
  if (state.phase.kind !== "ended") return;
  const { outcome } = state.phase;
  const heatMax = jobFor(state.config).heat.max;
  if (outcome.result === "failed" && outcome.reason === "heat") check(state.heat === heatMax, "a Heat failure is at max Heat");
  check(outcome.ranking.length === state.playerOrder.length, "everyone is ranked (design §13)");
  for (const r of outcome.ranking) {
    const p = state.players[r.player] as PlayerState;
    check(r.role === p.role && r.stash === p.stash + p.safe && r.safe === p.safe, "ranking matches the final stashes", { r, p });
  }
  for (let i = 1; i < outcome.ranking.length; i++) {
    check((outcome.ranking[i - 1]?.score ?? 0) >= (outcome.ranking[i]?.score ?? 0), "ranking is by score", outcome.ranking);
  }
  check(outcome.winners.every((w) => state.playerOrder.includes(w)), "winners are players");
  // design §3 (role deck v2 §0): the winning side's best score; Crew wins a success, the dark side a failure.
  const roles = rolesFor(state.config);
  const side = (role: string): boolean => isDarkSide(roles, role);
  const wantDark = outcome.result === "failed";
  const eligible = outcome.ranking.filter((r) => side(r.role) === wantDark);
  check(outcome.winners.every((w) => eligible.some((r) => r.player === w)), "winners are on the winning side (design §3)", outcome);
  check((eligible.length === 0) === (outcome.winners.length === 0), "the winning side always has a winner if dealt (design §3)", outcome);
  if (eligible[0]) check(outcome.winners.includes(eligible[0].player), "the side's best score wins (design §3)", outcome);
}

// ---------------------------------------------------------------- the driver

interface Played {
  readonly state: GameState;
  readonly commands: readonly unknown[];
  readonly accepted: number;
  readonly rejected: number;
}

/** Plays one fuzzed game, checking every invariant after every step. */
function play(config: GameConfig, tapeNumbers: readonly number[], checks = true): Played {
  const t = new Tape(tapeNumbers);
  const style = t.pick<Style>(["mixed", "hot", "careful"]);
  let state = deepFreeze(createGame(config));
  let inflow = 0;
  let accepted = 0;
  let rejected = 0;
  const commands: unknown[] = [];
  if (checks) {
    checkDeal(state);
    checkState(state, inflow);
  }
  const apply = (command: unknown, mustAccept: boolean, seated = true): void => {
    commands.push(command);
    const before = state;
    const r = handleCommand(state, command);
    if (!r.ok) {
      rejected++;
      if (checks) check(typeof r.reason === "string" && r.reason.length > 0, "a rejection has a reason");
      if (mustAccept) throw new Failure(`scheduler deadline refused: ${JSON.stringify(command)}: ${r.reason}`);
      return;
    }
    if (checks) check(seated, "a command for an unseated player is refused", command);
    accepted++;
    check(r.state.log.length === before.log.length + r.events.length, "events are appended to the log");
    inflow += lootFlow(r.events);
    state = deepFreeze(r.state);
  };

  const triedCancel = new Set<string>();
  let steps = 0;
  let lastPhase = state.phase.kind;
  while (state.phase.kind !== "ended") {
    if (++steps > 2000) throw new Failure("game did not end in 2000 steps");
    const deadlines = nextDeadlines(state);
    if (checks) {
      // design §4.1, §17.2: never stuck — some deadline the scheduler would send is accepted.
      check(deadlines.some((d) => handleCommand(state, d).ok), "some deadline is pending", state.phase);
    }
    if (t.done) {
      // Out of tape: only deadlines pass, except that a dealt Muscle cancels the first window it can (design §8).
      const muscle = state.phase.kind === "shakedownPending" ? state.playerOrder.find((id) => state.players[id]?.role === "muscle") : undefined;
      const window = state.pendingShakedown?.meetingId ?? "";
      if (muscle && !triedCancel.has(window)) {
        triedCancel.add(window);
        apply({ type: "useAbility", player: muscle, ability: { kind: "cancelShakedown" } }, false);
      } else {
        apply(deadlines[0], true);
      }
    } else {
      const kind = t.int(100);
      if (kind < 86) {
        const { command, seated } = playerCommand(state, t, style);
        apply(command, false, seated);
      } else if (kind < 93) {
        apply(garbageCommand(state, t), false);
      } else {
        apply(t.pick(deadlines), true);
      }
    }
    if (!checks) continue;
    checkState(state, inflow);
    // One viewer gets the full leak check every step; everyone at phase changes.
    checkView(state, t.pick(state.playerOrder), true);
    if (state.phase.kind !== lastPhase) for (const id of state.playerOrder) checkView(state, id, false);
    lastPhase = state.phase.kind;
    if (steps % 40 === 0) check(isDeepStrictEqual(replay(state.config, state.log), state), "replay(log) = state mid-game (design §17.2)");
  }
  if (checks) {
    checkEnd(state);
    check(isDeepStrictEqual(replay(state.config, state.log), state), "replay(log) = state at the end (design §17.2)");
    for (const id of state.playerOrder) checkView(state, id, true);
  }
  return { state, commands, accepted, rejected };
}

/** Plays a recorded command list (no generator). */
function rerun(config: GameConfig, commands: readonly unknown[]): GameState {
  let state = createGame(config);
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (r.ok) state = r.state;
  }
  return state;
}

/**
 * BUG (engine): objects that can't be turned into a string, which JSON.parse
 * makes from `{"toString":null}`, make handleCommand throw instead of refusing
 * (rejection reasons interpolate the raw value with String()/template strings).
 * `room` and `proposalId` reach the engine from a client; the server catches the
 * throw (live.ts `run`) and refuses with "command could not be handled", logging an error.
 * TODO(test/integration-suite PR, "Bugs found"): remove `.fails` once fixed.
 */
const HOSTILE = JSON.parse('{"toString":null}') as unknown;
const hostileCommands = (player: PlayerId): unknown[] => [
  { type: "submitMove", player, move: { room: HOSTILE, pocket: 0 } },
  { type: "acceptMeeting", player, proposalId: HOSTILE },
  { type: "submitMove", player: HOSTILE, move: { room: "lobby", pocket: 0 } },
  { type: "advance", deadline: { kind: "openMeeting", meetingId: HOSTILE } },
];

const duelFree: GameConfig = {
  seed: "x",
  players: [
    { id: "p1", name: "P1", isBot: false },
    { id: "p2", name: "P2", isBot: false },
    { id: "p3", name: "P3", isBot: false },
  ],
  job: "bank",
  rolePool: [],
  mole: "off",
  eventsEnabled: false,
  voteVisibility: "open",
  starterMode: false,
};

const params = { numRuns: RUNS, seed: SEED, endOnFailure: true } as const;

/**
 * fc.assert with a short report: the broken invariant, the config, and how to
 * replay it (the tape is thousands of numbers, so it is not printed; no shrinking).
 * Replay: FC_SEED=<seed> and `path` in fc params, or log `tape` in the property.
 */
function assertProperty<T extends [GameConfig, number[]]>(property: fc.IProperty<T>, options: fc.Parameters<T>): void {
  const details = fc.check(property, options);
  if (!details.failed) return;
  const [config] = details.counterexample ?? [];
  const error = details.errorInstance instanceof Error ? details.errorInstance : new Error(String(details.errorInstance));
  error.message = `${error.message}\n  seed ${details.seed}, path ${details.counterexamplePath}\n  config ${JSON.stringify(config)}`;
  throw error;
}

describe("engine invariants under fuzzing — design §17.2", () => {
  it("random configs and command streams keep every invariant, and every game ends", () => {
    const stats = { games: 0, accepted: 0, rejected: 0, players: new Set<number>(), outcomes: new Set<string>(), types: new Set<string>(), tape: 0 };
    assertProperty(
      fc.property(configArb, tapeArb, (config, tape) => {
        const { state, accepted, rejected } = play(config, tape);
        stats.games++;
        stats.tape += tape.length;
        stats.accepted += accepted;
        stats.rejected += rejected;
        stats.players.add(config.players.length);
        for (const e of state.log) stats.types.add(e.type === "abilityResolved" ? `ability:${e.ability.kind}` : e.type);
        if (state.phase.kind === "ended") stats.outcomes.add(state.phase.outcome.result === "success" ? "success" : state.phase.outcome.reason);
      }),
      params,
    );
    if (process.env.FC_STATS) console.log(JSON.stringify({ ...stats, players: [...stats.players], outcomes: [...stats.outcomes], types: [...stats.types].sort() }));
    // The streams really exercise both paths and several crew sizes and endings.
    expect(stats.accepted).toBeGreaterThan(stats.games * 10);
    expect(stats.rejected).toBeGreaterThan(stats.games * 5);
    expect(stats.players.size).toBeGreaterThanOrEqual(8);
    expect([...stats.outcomes].sort()).toEqual(["heat", "success", "target"]);
    for (const t of ["shakedownResolved", "shakedownCancelled", "copsRaided", "callOutResolved", "doubleCrossResolved", "raidRumourHit", "voteSealed"]) {
      expect(stats.types, t).toContain(t);
    }
  }, TIMEOUT);

  it("same seed + same commands = identical log; replaying the commands rebuilds the game", () => {
    assertProperty(
      fc.property(configArb, tapeArb, (config, tape) => {
        const a = play(config, tape, false);
        const b = play(config, tape, false);
        check(JSON.stringify(a.state.log) === JSON.stringify(b.state.log), "same seed + commands, same log");
        check(isDeepStrictEqual(rerun(config, a.commands), a.state), "re-running the recorded commands gives the same state");
      }),
      { ...params, numRuns: Math.max(5, Math.floor(RUNS / 4)) },
    );
  }, TIMEOUT);

  it.fails("BUG: a value with no string form ({\"toString\":null}) is refused, not thrown — see HOSTILE", () => {
    const state = createGame({ ...duelFree, seed: "hostile" });
    for (const c of hostileCommands("p1")) expect(handleCommand(state, c).ok).toBe(false);
  });

  it("garbage never throws, never changes the state, at any phase", () => {
    // Every garbage command against every state of a few fuzzed games.
    assertProperty(
      fc.property(configArb, tapeArb, (config, tape) => {
        const { commands } = play(config, tape, false);
        let state = deepFreeze(createGame(config));
        for (const [i, c] of commands.entries()) {
          const g = garbageCommand(state, new Tape([i * 7 + 3]));
          const before = JSON.stringify(state);
          const r = handleCommand(state, g);
          if (!r.ok) check(JSON.stringify(state) === before, "a rejection leaves the state as it was");
          const next = handleCommand(state, c);
          if (next.ok) state = deepFreeze(next.state);
        }
      }),
      { ...params, numRuns: Math.max(3, Math.floor(RUNS / 10)) },
    );
  }, TIMEOUT);
});
