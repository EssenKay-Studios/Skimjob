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
//  - loot is conserved: kitty + set-aside + stashes + coins spent on perks =
//    loot split from rooms (less a bust round's unsplit hand-ins); the coins
//    spent are every purchase's private cost, and its public one once planning
//    closes; nothing goes negative; the kitty
//    is change smaller than the crew; at the end the kitty and set-aside coins
//    pay the getaway car. [§5.5, §6.3, §7.2, §7.7, §10, §11.3, §12]
//  - coins are conserved: bank + seized + coins in the bags = the bank's
//    start. [§6.1, §7.7]
//  - every open room's bell is a whole number below its size (a full bell is
//    raided at once), a taped-off room has no bell, Wanted never goes down,
//    and the game is over once Wanted reaches the bust line. [§5.1–§5.5]
//  - the phase machine never sticks: until the game ends, some scheduler
//    deadline is accepted; and every game ends. [§4.1, §11, §17.2]
//  - phase and its companion fields agree (meeting, pendingShakedown). [§17.2]
//  - replay(config, log) rebuilds the state; same seed + commands = same log. [§17.2]
//  - viewFor never leaks: the ledger/case file are exactly what canSee allows,
//    and changing anything hidden from a player leaves their view identical. [§13, §17.2, §11.2]
//  - every player gets a role, at most two copies (two only at 11–12), eyes
//    and shadows within one. [§11.3]
//  - the end-of-game ranking matches the final stashes; the winners are the
//    top group (success), the Mole and Fixer holders in it (sunk by theft,
//    their handlers' rule), and on a bust the escapees with the biggest stash
//    among them. [§5.5, §8]
import { isDeepStrictEqual } from "node:util";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BANK_JOB, MAX_ROLE_COPIES, ROLES } from "@skimjob/content";
import type { Command, GameConfig, GameEvent, GameState, Move, PlayerId, PlayerState, RoleListSetting, VoteChoice, VoteVisibility } from "./types";
import { REVEAL, canSee, secretTo } from "./types";
import { createGame } from "./setup";
import { roleHandler } from "./roles";
import { handleCommand } from "./handle";
import { replay } from "./reduce";
import { viewFor } from "./view";
import { jobFor } from "./overrides";

const RUNS = Number(process.env.FC_RUNS ?? 90);
// Coverage of the endings and event types below is statistical, so 90 runs; the bust also has
// its own deterministic case. Any FC_SEED should reach all of it.
const SEED = Number(process.env.FC_SEED ?? 20261102);
const TIMEOUT = 60_000 + RUNS * 1_000;

// ---------------------------------------------------------------- configs

const VOTES: readonly VoteVisibility[] = ["hiddenThenRevealed", "open", "secret"];
const ROLE_LISTS: readonly RoleListSetting[] = ["exact", "possible", "hidden"];

const configArb = fc
  .record({
    players: fc.integer({ min: 3, max: 12 }),
    vote: fc.constantFrom(...VOTES),
    roleList: fc.constantFrom(...ROLE_LISTS),
    events: fc.boolean(),
    // Random streams ring a lot and seize coins, so some games move the bust line out of reach (design §5.5
    // [tunable]), and some of those also have a short round cap (§6.2), so games end by the cap as well as the bank.
    tuning: fc.constantFrom("shipped", "calm", "short"),
    seed: fc.string({ minLength: 1, maxLength: 12 }),
  })
  .map(({ players, vote, roleList, events, tuning, seed }): GameConfig => ({
    seed,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isBot: i % 2 === 1 })),
    job: "bank",
    roleList,
    eventsEnabled: events,
    voteVisibility: vote,
    ...(tuning === "shipped" ? {} : { contentOverrides: { alarm: { bustStars: 9 }, ...(tuning === "short" && { roundCap: 4 }) } }),
  }));
/** The command stream: each step reads a few numbers from this tape; when it runs out, only deadlines pass. */
const tapeArb = fc.array(fc.nat({ max: 0xffff }), { minLength: 400, maxLength: 4000, size: "max" });

// ---------------------------------------------------------------- the scheduler's deadlines

/** The deadline(s) that would pass next, as runBotGame's stand-in scheduler picks them. */
function nextDeadlines(state: GameState): Command[] {
  const phase = state.phase;
  if (phase.kind === "meeting") return [{ type: "advance", deadline: { kind: "closeMeeting", meetingId: phase.meetingId } }];
  if (phase.kind === "shakedownPending") return [{ type: "advance", deadline: { kind: "resolveShakedown", meetingId: phase.meetingId } }];
  const out: Command[] = [];
  if (state.pendingEmergency) out.push({ type: "advance", deadline: { kind: "openMeeting", meetingId: state.pendingEmergency.meetingId } });
  if (phase.kind === "planning") out.push({ type: "advance", deadline: { kind: "round", round: phase.round } });
  // design §9.3: the result window closes unless an emergency was called in it.
  if (phase.kind === "result" && !state.pendingEmergency) out.push({ type: "advance", deadline: { kind: "result", round: phase.round } });
  if (phase.kind === "awaitingMeeting") {
    if (state.scheduledMeeting) out.push({ type: "advance", deadline: { kind: "openMeeting", meetingId: state.scheduledMeeting.meetingId } });
    else out.push({ type: "scheduleMeeting", meetingId: phase.meetingId, slot: `server-${phase.meetingId}` });
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
/** Per game: how the crew plays. Hot crews court raids and busts; careful ones hand in and stay quiet. */
type Style = "mixed" | "hot" | "careful" | "greedy";

function playerCommand(state: GameState, t: Tape, style: Style): { command: Record<string, unknown>; seated: boolean } {
  const seated = t.chance(92);
  const player = !seated ? t.pick(BOGUS_PLAYERS) : t.pick(state.playerOrder);
  const p = seated ? (state.players[player as string] as PlayerState) : undefined;
  const room = (): string => {
    if (style === "hot" && t.chance(85)) return t.pick(["vault", "depositBoxes", "managersOffice"].filter((r) => state.rooms.includes(r)));
    if (style === "careful" && t.chance(60)) return t.pick(["office", "lobby", "rooftop"].filter((r) => state.rooms.includes(r)));
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
    fit && phase === "planning"
      ? 0
      : fit && phase === "result" && t.chance(30)
        ? 5
        : fit && phase === "meeting"
          ? 9
          : fit && phase === "shakedownPending"
            ? 13
            : fit && phase === "result" && t.chance(50)
              ? 14
              : t.int(15);
  switch (choice) {
    case 0:
    case 1:
    case 2:
    case 3:
    case 4: {
      const r = room();
      // design §3.2: mostly a grab that fills the room's limit, sometimes any number.
      const coins = BANK_JOB.rooms[r]?.coins ?? 0;
      // design §8.4: greedy crews pocket most whole grabs, so some heists are sunk by theft.
      const pocket = style === "greedy" ? (t.chance(80) ? coins : 0) : t.chance(style === "careful" ? 90 : 60) ? 0 : t.int(t.chance(80) ? 3 : 8);
      const move: Record<string, unknown> = { room: r, duffel: t.chance(80) ? Math.max(0, coins - pocket) : t.int(5), pocket };
      if (r === "security" || t.chance(5)) move.watch = room();
      if (p && t.chance(50)) {
        const ability = (() => {
          const kind = ROLES[p.role]?.power.kind;
          switch (kind) {
            case "lookout":
              return { kind: "lookout", rooms: [room()] };
            case "hide":
            case "blackout":
            case "ring":
              return { kind, room: room() };
            case "absolve":
              return { kind, target: t.pick(state.playerOrder) };
            case "reopen":
              return { kind: "reopen", room: t.chance(80) && Object.keys(state.taped).length > 0 ? t.pick(Object.keys(state.taped)) : room() };
            default:
              return t.chance(20) ? { kind: t.pick(["lookout", "ring", "reopen", "hide", "absolve"]) } : undefined;
          }
        })();
        if (ability) move.ability = ability;
      }
      return { command: { ...base, type: "submitMove", move }, seated };
    }
    case 5:
      return { command: { ...base, type: "postAlibi", round: t.int(state.resolvedRound + 2), room: room() }, seated };
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
      return { command: { ...base, type: "useAbility", ability: { kind: t.pick(["audit", "detect"]), room: room(), target: t.pick(state.playerOrder) } }, seated };
    case 13: {
      // design §9.6, §12: Bail's choice, and perks bought; the Mole's ring outside a move is refused (design §11.1).
      if (phase === "shakedownPending" && t.chance(70)) return { command: { ...base, type: "chooseBail", use: t.chance(60) }, seated };
      if (t.chance(10)) return { command: { ...base, type: "useAbility", ability: { kind: "ring", room: room() } }, seated };
      const kind = state.shop.length && t.chance(90) ? t.pick(state.shop) : "jetpack";
      return { command: { ...base, type: "buyPerk", perk: { kind, room: room(), target: t.pick(state.playerOrder) } }, seated };
    }
    default:
      return { command: { ...base, type: "callEmergency" }, seated };
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
    JSON.parse(`{"type":"submitMove","player":"${player}","move":{"room":"lobby","duffel":1,"pocket":0},"__proto__":{"pocket":5}}`),
    { type: "submitMove", player },
    { type: "submitMove", player, move: null },
    { type: "submitMove", player, move: { room: "lobby", duffel: 1, pocket: -1 } },
    { type: "submitMove", player, move: { room: "lobby", duffel: 1, pocket: 1.5 } },
    { type: "submitMove", player, move: { room: "lobby", duffel: 1, pocket: Number.NaN } },
    { type: "submitMove", player, move: { room: "lobby", duffel: 1, pocket: "1" } },
    { type: "submitMove", player, move: { room: "vault", duffel: 0, pocket: 1e9 } },
    { type: "submitMove", player, move: { room: "vault", duffel: 1e9, pocket: 0 } },
    { type: "submitMove", player, move: { room: "vault", duffel: -1, pocket: 2 } },
    { type: "submitMove", player, move: { room: "vault", duffel: 0, pocket: 0 } },
    { type: "submitMove", player, move: { room: "rooftop", duffel: 1, pocket: 0 } },
    { type: "submitMove", player, move: { room: "lobby", duffel: 1, pocket: 0, watch: "vault" } },
    { type: "submitMove", player, move: { room: "security", pocket: 0 } },
    { type: "submitMove", player, move: { room: "lobby", duffel: 1, pocket: 0, ability: { kind: "lookout", rooms: -3 } } },
    { type: "submitMove", player, move: { room: "lobby", duffel: 1, pocket: 0, ability: "ring" } },
    { type: "castVote", player, vote: null },
    { type: "castVote", player, vote: { kind: "shakedown" } },
    { type: "castVote", player, vote: { kind: "shakedown", target: player } },
    { type: "sealVote", player, vote: { kind: "maybe" } },
    { type: "postAlibi", player, room: 3 },
    { type: "acceptMeeting", player, proposalId: { id: 1 } },
    { type: "proposeMeeting", player, slot: 9 },
    { type: "useAbility", player, ability: { kind: "reopen", room: "vault" } },
    { type: "submitMove", player, move: { room: "lobby", duffel: 1, pocket: 0, ability: { kind: "ring", room: "rooftop" } } },
    { type: "submitMove", player, move: { room: "lobby", duffel: 1, pocket: 0, ability: { kind: "ring", room: { toString: 1 } } } },
    // Wrong or malformed deadlines.
    { type: "advance" },
    { type: "advance", deadline: null },
    { type: "advance", deadline: { kind: "nap" } },
    { type: "advance", deadline: { kind: "round", round: String(state.round) } },
    { type: "advance", deadline: { kind: "round", round: state.round + 1 } },
    { type: "advance", deadline: { kind: "round", round: state.round - 1 } },
    { type: "advance", deadline: { kind: "round", round: state.round, plan: { entries: [{ player: "p99", placed: null, room: null, power: null, agreed: true }], history: [] } } },
    { type: "advance", deadline: { kind: "openMeeting", meetingId: "meeting-9" } },
    { type: "advance", deadline: { kind: "result", round: 99 } },
    { type: "advance", deadline: { kind: "closeMeeting", meetingId: "emergency-nobody" } },
    { type: "advance", deadline: { kind: "resolveShakedown", meetingId: "meeting-1" } },
    { type: "scheduleMeeting", meetingId: "meeting-4", slot: "x" },
    { type: "scheduleMeeting", meetingId: "meeting-1", slot: null },
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
    if (e.type === "coinsGrabbed") n += e.duffel + e.pocket;
  }
  return n;
}

/** design §5.5: a bust round's hand-ins are never split; they are lost in the bust. */
function lostInBust(state: GameState): number {
  if (state.phase.kind !== "ended" || state.phase.outcome.result !== "failed" || state.phase.outcome.reason !== "bust") return 0;
  return state.log.reduce((n, e) => n + (e.type === "coinsGrabbed" && e.round === state.resolvedRound ? e.duffel : 0), 0);
}

function holdings(state: GameState): number {
  return state.kitty + state.setAside + state.spent + lostInBust(state) + Object.values(state.players).reduce((sum, p) => sum + p.stash, 0);
}

const isCount = (n: number): boolean => Number.isInteger(n) && n >= 0;

class Failure extends Error {}
function check(ok: boolean, what: string, detail?: unknown): void {
  if (!ok) throw new Failure(`${what}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
}

/** Invariants on one state. `inflow` is the running loot flow. */
function checkState(state: GameState, inflow: number): void {
  const { bulbs, bustStars } = jobFor(state.config).alarm;
  // design §5.1, §5.3: a full bell is raided at once, so every open bell is below its size; a taped-off room's is off.
  for (const room of state.rooms) {
    const open = Object.hasOwn(state.bells, room);
    check(open !== Object.hasOwn(state.taped, room), "each room in play has a bell or tape, never both", { room, bells: state.bells, taped: state.taped });
    if (open) check(isCount(state.bells[room] as number) && (state.bells[room] as number) < bulbs, "an open bell is a whole number below its size", state.bells);
    else check((state.taped[room] as number) >= state.round, "a taped-off room is closed through this round or later", state.taped);
  }
  check(Object.keys(state.bells).every((r) => state.rooms.includes(r)), "bells only for rooms in play", state.bells);
  // design §5.4, §5.5: Wanted counts the raids and never goes down; at the bust line the game is over.
  const raids = state.log.filter((e) => e.type === "roomRaided").length;
  check(state.wanted === raids, "Wanted = raids so far", { wanted: state.wanted, raids });
  if (state.wanted >= bustStars) check(state.phase.kind === "ended", "the game is over at the bust line (design §5.5)", state.phase);
  // design §7.2, §7.3, §7.5: the share and set-aside coins are whole numbers, the kitty is change smaller than the crew,
  // and honesty's numerator never passes the coins taken.
  check(isCount(state.share) && isCount(state.setAside) && isCount(state.reached), "share, set-aside and reached are whole numbers ≥ 0", [state.share, state.setAside, state.reached]);
  check(isCount(state.kitty) && state.kitty < state.playerOrder.length, "the kitty is change smaller than the crew", state.kitty);
  const taken = jobFor(state.config).bank.coinsPerPlayer * state.playerOrder.length - state.bank - state.seized;
  check(state.reached <= taken, "coins reached ≤ coins taken (design §7.5)", [state.reached, taken]);
  for (const p of Object.values(state.players)) check(isCount(p.stash), "stashes are whole numbers ≥ 0", p);
  check(holdings(state) === inflow, "loot conservation (kitty + set-aside + stashes + spent = loot in − loot out, design §7.7)", { holdings: holdings(state), inflow });
  // design §12: the coins spent on perks are each buyer's private cost, and once planning closes every purchase's public one.
  const planning = state.phase.kind === "planning" ? state.round : null;
  const sold = state.log.reduce((n, e) => n + (e.type === "perkSold" ? e.cost : 0), 0);
  const paid = state.log.reduce((n, e) => n + (e.type === "perkBought" ? e.cost : 0), 0);
  const announced = state.log.reduce((n, e) => n + (e.type === "perkBought" && e.round !== planning ? e.cost : 0), 0);
  check(state.spent === paid && sold === announced, "coins spent on perks = private costs; public costs = purchases of closed rounds", [state.spent, paid, sold, announced]);
  // design §6.1, §7.7: every coin grabbed came out of the bank (into a bag, or seized), and the bank never goes below 0.
  const filled = state.log.find((e) => e.type === "bankFilled");
  const grabbed = state.log.reduce((n, e) => n + (e.type === "coinsGrabbed" ? e.duffel + e.pocket + e.seized : 0), 0);
  const seized = state.log.reduce((n, e) => n + (e.type === "coinsGrabbed" ? e.seized : 0), 0);
  check(isCount(state.bank) && filled?.type === "bankFilled" && state.bank === filled.coins - grabbed, "bank conservation (bank = filled − grabbed ≥ 0)", { bank: state.bank, grabbed });
  check(state.seized === seized, "the seized total is every visitor's seized grab (design §5.3)", { seized: state.seized, grabs: seized });
  // Phase companions. design §17.2
  check((state.phase.kind === "meeting") === (state.meeting !== null), "meeting set exactly in the meeting phase", state.phase);
  check((state.phase.kind === "shakedownPending") === (state.pendingShakedown !== null), "pendingShakedown set exactly in its phase", state.phase);
  const { roundCap } = jobFor(state.config);
  check(state.round >= 1 && state.round <= roundCap && state.resolvedRound <= state.round, "rounds 1 up to the cap, resolved ≤ started (design §6.2)", [state.round, state.resolvedRound]);
  // design §6.2: the game ends after the round that empties the bank or reaches the cap; no round or meeting follows.
  if (state.resolvedRound > 0 && (state.bank === 0 || state.resolvedRound === roundCap)) check(state.phase.kind === "ended", "the game is over once the bank is empty or the cap is reached", state.phase);
  if (state.phase.kind === "planning") check(state.phase.round === state.round, "planning the latest round");
  // design §11.3: one alibi per player and round.
  const alibis = state.log.flatMap((e) => (e.type === "said" && e.statement.kind === "alibi" ? [`${e.statement.player}/${e.statement.round}`] : []));
  check(new Set(alibis).size === alibis.length, "one alibi per player per round", alibis);
  // design §9.3: the pool only shrinks, by one per call, and an emergency is only ever pending in the result window.
  const calls = state.log.filter((e) => e.type === "emergencyMeetingCalled").length;
  check(state.emergencies === (state.playerOrder.length <= 6 ? 1 : 2) - calls && state.emergencies >= 0, "the emergency pool = its size − calls ≥ 0", [state.emergencies, calls]);
  if (state.pendingEmergency) check(state.phase.kind === "result", "an emergency is pending only in the result window", state.phase);
  // design §9.1, §9.7: one regular meeting per third of the bank; protection only for players a shakedown passed against.
  const regulars = state.log.filter((e) => e.type === "meetingOpened" && e.kind === "regular").length;
  check(regulars <= state.thirds && state.stretch === regulars + 1, "a regular meeting per third of the bank, each starting a stretch", [regulars, state.thirds, state.stretch]);
  const shaken = new Set(state.log.flatMap((e) => (e.type === "shakedownResolved" || e.type === "shakedownCancelled" ? [e.target] : [])));
  check(state.protected.every((id) => shaken.has(id)), "only shaken-down players are protected", state.protected);
}

/** design §11.3: every player gets a role; at most two copies, two only at 11–12 players; eyes and shadows within one. */
function checkDeal(state: GameState): void {
  const roles = state.playerOrder.map((id) => (state.players[id] as PlayerState).role);
  const n = roles.length;
  for (const r of new Set(roles)) check(roles.filter((x) => x === r).length <= (n <= 10 ? 1 : MAX_ROLE_COPIES), `copies of ${r}`, roles);
  const eyes = roles.filter((r) => ROLES[r]?.kind === "eyes").length;
  check(Math.abs(eyes - (n - eyes)) <= 1 && roles.every((r) => Object.hasOwn(ROLES, r)), "eyes and shadows within one", roles);
}

/**
 * The state with everything hidden from `viewer` changed: other players'
 * private fields, moves and ballots, the seed and RNG,
 * and hidden events (dropped, junk added).
 */
/** The open meeting's ballots `viewer` sees through their Check ballots. design §12 */
function seenBy(meeting: NonNullable<GameState["meeting"]>, viewer: PlayerId): Record<PlayerId, VoteChoice> {
  const grants = Object.hasOwn(meeting.ballotGrants, viewer) ? (meeting.ballotGrants[viewer] as readonly PlayerId[]) : [];
  return Object.fromEntries(grants.filter((id) => Object.hasOwn(meeting.votes, id)).map((id) => [id, meeting.votes[id] as VoteChoice]));
}

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
            role: p.role === "priest" ? "hacker" : "priest",
            stash: p.stash + 101,
            roleState: { usedThisStretch: 4, usedThisGame: 1, bail: !p.roleState.bail },
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
  // Who has locked in a move is public (owner decision, 2 Nov; design §5.1), what they picked is not.
  const fakeMoves: Record<PlayerId, Move> = {};
  for (const id of state.playerOrder) {
    if (Object.hasOwn(state.moves, id)) fakeMoves[id] = id === viewer ? (state.moves[id] as Move) : { room: "vault", duffel: 0, pocket: 3 };
  }
  // design §5.1, §11.1: a hidden bell's real bulbs are the Hacker's alone; a blackout for next round is unannounced.
  const hid = (room: string) =>
    state.log.some((e) => e.type === "abilityResolved" && e.player === viewer && e.round === state.round && e.ability.kind === "hide" && e.ability.room === room);
  const bells = Object.fromEntries(Object.entries(state.bells).map(([room, n]) => [room, state.hidden.includes(room) && !hid(room) ? n + 7 : n]));
  return {
    ...state,
    bells,
    cutsPending: ["vault", "lobby"],
    // design §9.6, §12: Check ballots waiting for the next meeting and a Bail choice are private.
    ballotChecks: [{ player: other, target: viewer }, ...state.ballotChecks.filter((c) => c.player === viewer)],
    pendingShakedown: state.pendingShakedown && { ...state.pendingShakedown, useBail: state.pendingShakedown.target === viewer ? state.pendingShakedown.useBail : !state.pendingShakedown.useBail },
    config: { ...state.config, seed: "scrubbed" },
    rng: { words: [1, 2, 3, 4] },
    players,
    moves: fakeMoves,
    meeting: state.meeting && {
      ...state.meeting,
      // The ballots the viewer bought a Check ballot for are theirs to see (design §12).
      // A granted ballot not yet cast reads null either way, so it is never faked.
      votes: Object.fromEntries(Object.entries({ ...fakeFor(state.meeting.votes, { kind: "shakedown", target: viewer }), ...seenBy(state.meeting, viewer) }).filter(([id]) => !(state.meeting?.ballotGrants[viewer] ?? []).includes(id) || Object.hasOwn(state.meeting?.votes ?? {}, id))),
      ballotGrants: fakeFor(state.meeting.ballotGrants, [viewer]),
    },
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
  check(view.players.every((o) => Object.keys(o).sort().join() === "id,isBot,name"), "others show public fields only");
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
  const job = jobFor(state.config);
  if (outcome.result === "failed" && outcome.reason === "bust") check(state.wanted >= job.alarm.bustStars, "a bust is at the bust line");
  else {
    // design §6.2, §8.1, §8.4: otherwise the bank or the cap ended it, and honesty (coins that reached the duffel ÷ the coins taken, seized
    // ones left out, §7.5) at or above the line is a success, below it sunk by theft.
    check(state.bank === 0 || state.resolvedRound === job.roundCap, "the bank or the round cap ended the game", [state.bank, state.resolvedRound]);
    const taken = (state.log.find((e) => e.type === "bankFilled") as { coins: number }).coins - state.bank - state.seized;
    const honest = taken === 0 || state.reached / taken >= job.honestyLine;
    check(outcome.result === (honest ? "success" : "failed"), "success at or above the honesty line, sunk by theft below it", { reached: state.reached, taken, outcome: outcome.result });
    // design §6.3: the kitty and any unsplit duffel pay for the getaway car.
    check("getaway" in outcome && outcome.getaway === state.kitty + state.setAside, "the getaway car takes the kitty and set-aside coins", outcome);
  }
  check(outcome.ranking.length === state.playerOrder.length, "everyone is ranked (design §13)");
  for (const r of outcome.ranking) {
    const p = state.players[r.player] as PlayerState;
    check(r.role === p.role && r.stash === p.stash, "ranking matches the final stashes", { r, p });
  }
  for (let i = 1; i < outcome.ranking.length; i++) {
    check((outcome.ranking[i - 1]?.stash ?? 0) >= (outcome.ranking[i]?.stash ?? 0), "ranking is by stash", outcome.ranking);
  }
  check(outcome.winners.every((w) => state.playerOrder.includes(w)), "winners are players");
  // design §8.5: the top group (everyone tied for the biggest stash, no tie-break) wins a success;
  // a heist sunk by theft only its Mole and Fixer holders (their handlers' rule, §8.4).
  const first = outcome.ranking[0];
  const level = (r: (typeof outcome.ranking)[number]) => first !== undefined && r.stash === first.stash;
  // design §5.5: on a bust, the escapees (the round's Rooftop players) with the biggest stash among them, any role.
  const escaped = outcome.result === "failed" && outcome.reason === "bust" ? outcome.ranking.filter((r) => outcome.escapees.includes(r.player)) : [];
  const best = Math.max(...escaped.map((r) => r.stash));
  const eligible =
    outcome.result === "failed" && outcome.reason === "bust"
      ? escaped.filter((r) => r.stash === best)
      : outcome.ranking.filter((r) => level(r) && (outcome.result === "success" || roleHandler(r.role).winsSunk !== undefined));
  check(isDeepStrictEqual([...outcome.winners].sort(), eligible.map((r) => r.player).sort()), "winners = the eligible top group", outcome);
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
  const style = t.pick<Style>(["mixed", "hot", "careful", "greedy"]);
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
      // Out of tape: only deadlines pass.
      apply(deadlines[0], true);
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
 * Objects that can't be turned into a string, which JSON.parse makes from
 * `{"toString":null}`, used to make handleCommand throw (refusal reasons
 * interpolated the raw value). Refused now; commands.hostile.test.ts covers
 * every field of every command.
 */
const HOSTILE = JSON.parse('{"toString":null}') as unknown;
const hostileCommands = (player: PlayerId): unknown[] => [
  { type: "submitMove", player, move: { room: HOSTILE, pocket: 0 } },
  { type: "acceptMeeting", player, proposalId: HOSTILE },
  { type: "submitMove", player: HOSTILE, move: { room: "lobby", pocket: 0 } },
  { type: "advance", deadline: { kind: "openMeeting", meetingId: HOSTILE } },
];

const threeSeats: GameConfig = {
  seed: "x",
  players: [
    { id: "p1", name: "P1", isBot: false },
    { id: "p2", name: "P2", isBot: false },
    { id: "p3", name: "P3", isBot: false },
  ],
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "open",
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
    expect([...stats.outcomes].sort()).toEqual(["bust", "success", "theft"]);
    for (const t of ["shakedownResolved", "roomRaided", "bellsCooled", "roomReopened", "ability:ring", "ability:hide", "ability:absolve", "sinsAbsolved", "powerCut", "voteSealed"]) {
      expect(stats.types, t).toContain(t);
    }
  }, TIMEOUT);

  it("a game at Wanted 2 with a hot Vault ends as a bust, with the end invariants holding (design §5.5)", () => {
    const start = createGame({ ...threeSeats, seed: "bust-end" });
    const moved = handleCommand({ ...start, wanted: 2, bells: { ...start.bells, vault: 4 } }, { type: "submitMove", player: "p1", move: { room: "vault", duffel: 1, pocket: 0 } });
    if (!moved.ok) throw new Failure(moved.reason);
    let state: GameState = moved.state;
    for (let steps = 0; state.phase.kind !== "ended"; steps++) {
      if (steps > 200) throw new Failure("game did not end in 200 steps");
      const next = nextDeadlines(state).map((c) => handleCommand(state, c)).find((r) => r.ok);
      if (!next || !next.ok) throw new Failure("no deadline accepted");
      state = next.state;
    }
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { result: "failed", reason: "bust", escapees: [], winners: [] } });
    checkEnd(state);
  });

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

  it("a value with no string form ({\"toString\":null}) is refused, not thrown — see HOSTILE", () => {
    const state = createGame({ ...threeSeats, seed: "hostile" });
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
