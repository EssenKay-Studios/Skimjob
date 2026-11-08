// QA (PR #25, role deck v2 R1): perks — double spends, wrong phases, +Vote stacking, Recharge on the Mole, a Rig spent
// at a regular meeting, view diffs while perks are held and spent, determinism.
// design §8.3 (docs/roles-v2.md §1), §9.5, §9.6; extension.md "Tokens and the
// perk shop" (one perk use per round)
import { describe, expect, it } from "vitest";
import type { PerkId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { grantPerks } from "./perks.testkit";
import { fullGrab } from "./grab.testkit";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "perk-qa",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
  };
}
function game(players: number, roles: string[] = [], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  let seat = 0;
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "lookout" } : e)));
}
/** The game with a shop that holds no Shield, so a passed shakedown applies at once (no window, design §9.6). */
const noShieldShop = (s: GameState): GameState =>
  replay(s.config, s.log.map((e): GameEvent => (e.type === "shopDealt" ? { ...e, perks: ["peek", "alibi", "extraVote"] } : e)));
type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
    // A step may be several commands, worked out from the state as it reaches them.
    if (Array.isArray(command)) return run(s, ...(command as Cmd[]));
    const r = handleCommand(s, command);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
    return r.state;
  }, state);
}
function refused(state: GameState, command: unknown): string {
  const r = handleCommand(state, command);
  if (r.ok) throw new Error(`expected a rejection of ${JSON.stringify(command)}`);
  return r.reason;
}
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const use = (player: string, ability: object) => ({ type: "useAbility", player, ability });
const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { ...fullGrab(room, pocket), ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const CLOSE_ALIBIS = (s: GameState) => ({ type: "advance", deadline: { kind: "alibis", round: s.resolvedRound } });
/** The alibis close, then the result window (design §9.3), nobody calling an emergency. */
const ALIBIS = (s: GameState): Cmd[] => [
  CLOSE_ALIBIS(s),
  (x: GameState) => (x.phase.kind === "result" ? { type: "advance", deadline: { kind: "result", round: x.phase.round } } : []),
];
/** The server picks the slot of the meeting the round called (design §9.4). */
const SCHED = (s: GameState) => ({ type: "scheduleMeeting", meetingId: s.phase.kind === "awaitingMeeting" ? s.phase.meetingId : null, slot: "x" });
const OPEN = (s: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting?.meetingId } });
const RESULT = (s: GameState) => ({ type: "advance", deadline: { kind: "result", round: s.resolvedRound } });
/** Default rounds until a third of the bank is gone and a regular meeting is due (design §9.1). */
const toRegular = (s: GameState): GameState => {
  while (s.phase.kind !== "awaitingMeeting") s = run(s, ROUND, ALIBIS);
  return s;
};
/** The round being planned resolves (if one is) and, in its result window, `by` calls the crew's emergency, which opens at once. design §9.3 */
const emergency = (by: string): Cmd[] => [
  (s: GameState) => (s.phase.kind === "planning" ? [ROUND, CLOSE_ALIBIS] : s.phase.kind === "alibis" ? [CLOSE_ALIBIS] : []),
  { type: "callEmergency", player: by },
  (s: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.pendingEmergency?.meetingId } }),
];
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const RESOLVE = (s: GameState) => ({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.pendingShakedown?.meetingId } });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: target ? { kind: "shakedown", target } : { kind: "skip" } });
const perks = (s: GameState, id: string): readonly PerkId[] => (s.players[id] as PlayerState).roleState.perks;
const withStash = (s: GameState, id: string, stash: number): GameState => ({ ...s, players: { ...s.players, [id]: { ...(s.players[id] as PlayerState), stash } } });
/** The shop pinned with a Shield, so a passed shakedown waits for its window (extension.md "Shakedowns"). */
const withShield = (s: GameState): GameState => ({ ...s, shop: ["peek", "shield", "extraVote"] });
const closed = (s: GameState) => s.log.filter((e) => e.type === "meetingClosed").at(-1);

/** Each spendable perk: the state it can be spent in, and the spend. */
const SPENDS: readonly [PerkId, () => GameState, object][] = [
  ["peek", () => game(4), { kind: "peek", target: "p1" }],
  ["tail", () => game(4), { kind: "tail", room: "vault" }],
  ["extraVote", () => run(game(4), ...emergency("p1")), { kind: "extraVote" }],
  ["ballot", () => run(game(4), ...emergency("p1")), { kind: "ballot", target: "p1" }],
  ["alibi", () => run(game(4), mv("p0", "office"), ROUND, { type: "postAlibi", player: "p0", room: "office" }), { kind: "alibi" }],
  ["recharge", () => run(game(4, ["hacker"]), mv("p0", "lobby", 0, { ability: { kind: "hide", room: "vault" } }), ROUND, ALIBIS), { kind: "recharge" }],
  ["rig", () => game(4, [], { eventsEnabled: true }), { kind: "rig" }],
];

describe("QA: one token, one spend — design §8.3", () => {
  it.each(SPENDS)("%s: spent once; a second spend with no token left is refused and writes nothing", (perk, at, ability) => {
    const s = run(grantPerks(at(), "p0", perk), use("p0", ability));
    expect(perks(s, "p0")).toEqual([]);
    expect(refused(s, use("p0", ability))).toMatch(/you have no/);
    // A spend without ever holding one is refused the same way.
    expect(refused(at(), use("p0", ability))).toMatch(/you have no/);
  });

  it("the Shield can never be spent by hand; an unknown kind is refused", () => {
    const s = grantPerks(game(4), "p0", "shield");
    expect(refused(s, use("p0", { kind: "shield" }))).toMatch(/by itself/);
    expect(refused(s, use("p0", { kind: "teleport" }))).toBeTruthy();
    expect(perks(s, "p0")).toEqual(["shield"]);
  });
});

describe("QA: wrong phase — design §8.3", () => {
  it("Tail only while planning: refused in the alibis, a meeting and a shakedown window", () => {
    const s = grantPerks(withShield(game(4)), "p0", "tail");
    const tail = use("p0", { kind: "tail", room: "vault" });
    expect(refused(run(s, ROUND), tail)).toMatch(/being planned/);
    expect(refused(run(s, ...emergency("p1")), tail)).toMatch(/being planned/);
    const pending = run(s, ...emergency("p1"), vote("p1", "p2"), vote("p2", "p3"), vote("p3", "p2"), vote("p0", "p2"), CLOSE);
    expect(pending.phase.kind).toBe("shakedownPending");
    expect(refused(pending, tail)).toMatch(/being planned/);
  });

  it("+Vote and Ballot are refused once the vote is tallied (shakedown window) and in the alibis", () => {
    const s = grantPerks(withShield(game(4)), "p0", "extraVote", "ballot");
    const pending = run(s, ...emergency("p1"), vote("p1", "p2"), vote("p2", "p3"), vote("p3", "p2"), vote("p0", "p2"), CLOSE);
    expect(pending.phase.kind).toBe("shakedownPending");
    for (const st of [pending, run(s, ROUND)]) {
      expect(refused(st, use("p0", { kind: "extraVote" }))).toMatch(/meeting is open/);
      expect(refused(st, use("p0", { kind: "ballot", target: "p1" }))).toMatch(/meeting is open/);
    }
    expect(perks(pending, "p0")).toEqual(["extraVote", "ballot"]);
  });

  it("no perk can be spent once the game is over", () => {
    const s = grantPerks(game(4), "p0", "peek");
    // Wanted 2, and a Vault raid makes it a bust (design §5.5).
    const over = run({ ...s, wanted: 2 }, mv("p0", "vault"), mv("p1", "vault"), mv("p2", "vault"), mv("p3", "vault"), ROUND);
    expect(over.phase.kind).toBe("ended");
    expect(refused(over, use("p0", { kind: "peek", target: "p1" }))).toMatch(/over/);
  });

  it("Rig: refused with no next card (last round), allowed for round 2 from round 1", () => {
    const s = grantPerks(game(4, [], { eventsEnabled: true }), "p0", "rig");
    expect(refused({ ...s, round: 12 }, use("p0", { kind: "rig" }))).toMatch(/no next event card/); // the round cap (design §6.2)
    expect(since(s, run(s, use("p0", { kind: "rig" })))[0]).toMatchObject({ type: "perkUsed", perk: { kind: "rig", round: 2 } });
  });
});

describe("QA: +Vote, Recharge, Rig at the meeting — design §8.3", () => {
  it("+Vote stacks with the Smooth Talker's double vote (weight 3)", () => {
    const s = run(grantPerks(game(6, ["smoothTalker"]), "p0", "extraVote"), ...emergency("p0"));
    const votes = [vote("p0", "p5"), vote("p1", null), vote("p2", null), vote("p3", null)];
    // 2 vs 3: skipped; 3 vs 3: no majority either way.
    expect(closed(run(s, ...votes, CLOSE))).toMatchObject({ result: { kind: "skipped" } });
    expect(closed(run(s, use("p0", { kind: "extraVote" }), ...votes, CLOSE))).toMatchObject({ result: { kind: "noMajority" } });
    expect(closed(run(s, use("p0", { kind: "extraVote" }), ...votes.slice(0, 3), CLOSE))).toMatchObject({ result: { kind: "shakedown", target: "p5" } });
  });

  it("Recharge gives the Mole a second ring between the same meetings (design §11.1)", () => {
    const RING = mv("p0", "lobby", 0, { ability: { kind: "ring", room: "office" } });
    let s = grantPerks(game(4, ["mole"], { roleList: "possible" }), "p0", "recharge");
    s = run(s, RING, ROUND, ALIBIS);
    expect(refused(s, RING)).toMatch(/already rung/);
    s = run(s, use("p0", { kind: "recharge" }), RING, ROUND);
    expect(s.log.filter((e) => e.type === "abilityResolved" && e.ability.kind === "ring")).toHaveLength(2);
  });

  it("a Rig spent at a regular meeting picks the next round's card, flipped when that round starts (design §9.1, §13)", () => {
    let s = toRegular(grantPerks(game(4, [], { eventsEnabled: true }), "p0", "rig"));
    s = run(s, SCHED, OPEN, use("p0", { kind: "rig" }));
    const spent = [...s.log].reverse().find((e) => e.type === "perkUsed");
    if (spent?.type !== "perkUsed" || spent.perk.kind !== "rig") throw new Error("no Rig");
    const round = s.round + 1;
    expect(spent.perk.round).toBe(round);
    const pick = spent.perk.cards[1] as string;
    const next = run(s, use("p0", { kind: "rigPick", card: pick }), CLOSE, RESULT);
    expect(next.round).toBe(round);
    expect(next.card?.id).toBe(pick);
    expect(next.rigs).toEqual([]);
  });
});

describe("QA: perks never leak to other views — design §8.3, §17.2", () => {
  it("holding and spending Peek, Tail, Rig, rigPick, Recharge, +Vote and Ballot change no other player's view", () => {
    // 7 players: the crew's pool holds 2 emergencies (design §9.3).
    let s = grantPerks(game(7, ["hacker"], { eventsEnabled: true, voteVisibility: "secret" }), "p0", "peek", "tail", "rig", "recharge", "extraVote", "ballot");
    const others = ["p1", "p2", "p3"];
    const views = (st: GameState) => others.map((id) => JSON.stringify(viewFor(st, id)));
    const check = (before: GameState, ...cmds: Cmd[]): GameState => {
      const after = run(before, ...cmds);
      expect(views(after)).toEqual(views(before));
      return after;
    };
    // One perk use per round (extension.md "Tokens and the perk shop"), so the spends spread over rounds.
    const next = (st: GameState) => run(st, ROUND, ALIBIS);
    s = check(s, use("p0", { kind: "peek", target: "p1" }));
    s = next(s);
    s = check(s, use("p0", { kind: "tail", room: "vault" }));
    s = next(s);
    s = check(s, use("p0", { kind: "rig" }));
    const rig = s.rigs[0];
    if (!rig) throw new Error("no rig");
    s = check(s, use("p0", { kind: "rigPick", card: rig.cards[1] }));
    s = run(toRegular(next(s)), SCHED, OPEN, CLOSE, RESULT);
    s = run(s, mv("p0", "lobby", 0, { ability: { kind: "hide", room: "vault" } }), ROUND);
    s = check(s, use("p0", { kind: "recharge" }));
    s = run(s, ALIBIS);
    s = run(s, ...emergency("p2"));
    s = check(s, use("p0", { kind: "extraVote" }));
    s = run(s, CLOSE, ROUND, ALIBIS);
    s = run(s, ...emergency("p1"), vote("p1", "p2"));
    s = check(s, use("p0", { kind: "ballot", target: "p1" }));
    expect(viewFor(s, "p0").me.seenBallots).toEqual({ p1: { kind: "shakedown", target: "p2" } });
    // p1's own view doesn't learn it is watched; no other view sees perks.
    for (const id of others) {
      expect(viewFor(s, id).me.seenBallots).toEqual({});
      expect(JSON.stringify(viewFor(s, id))).not.toMatch(/perkUsed|perkGranted|rigPicked/);
    }
  });
});

describe("QA: determinism with perks — design §17.2", () => {
  it("same seed + same commands give the same log; the log replays to the same state", () => {
    const script = (): GameState => {
      let s = grantPerks(noShieldShop(game(5, ["lookout"], { eventsEnabled: true })), "p0", "rig", "shield");
      s = grantPerks(grantPerks(grantPerks(s, "p2", "tail"), "p3", "peek"), "p4", "ballot");
      s = run(s, use("p0", { kind: "rig" }), use("p2", { kind: "tail", room: "vault" }), use("p3", { kind: "peek", target: "p4" }));
      // The Vault's 6 rings raid it: a police briefing follows (design §9.2).
      s = run(s, mv("p0", "lobby"), mv("p1", "vault", 2), mv("p2", "vault"), ROUND, CLOSE_ALIBIS);
      s = run(s, SCHED, OPEN, use("p4", { kind: "ballot", target: "p1" }), vote("p1", "p0"), vote("p2", "p0"), vote("p3", "p0"), vote("p4", "p0"), CLOSE);
      return s;
    };
    const a = script();
    const b = script();
    expect(b.log).toEqual(a.log);
    expect(a.log.some((e) => e.type === "perkUsed" && e.perk.kind === "shield")).toBe(true);
    expect(replay(a.config, a.log)).toEqual(a);
  });
});

describe("QA: Shield vs a plain shakedown — design §8.3, §9.6, §9.7", () => {
  /** Round 1 resolves and `by` calls the crew's emergency; the meeting opens. */
  const opened = (s: GameState, by = "p1") => run(s, ...emergency(by));
  /** Everyone else votes p0 down. */
  const passOnP0 = (open: GameState) => run(open, ...open.playerOrder.filter((p) => p !== "p0").map((p) => vote(p, "p0")), CLOSE);
  const stashes = (s: GameState) => Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, p.stash]));

  it("plain: what is above the share is set aside for the next split; Shield: stash kept, nothing set aside, one Shield per passed shakedown", () => {
    // 7 players: the crew's pool holds 2 emergencies (design §9.3).
    const base = withStash(noShieldShop(game(7)), "p0", 6);
    const open = opened(base);
    const plain = passOnP0(open);
    expect(plain.players.p0?.stash).toBe(open.share);
    expect(plain.setAside).toBe(open.setAside + 6);

    const two = opened(grantPerks(base, "p0", "shield", "shield"));
    const first = passOnP0(two);
    expect(first.players.p0).toMatchObject({ stash: 6 + two.share });
    expect(first.setAside).toBe(two.setAside);
    expect(stashes(first)).toEqual(stashes(two));
    expect(perks(first, "p0")).toEqual(["shield"]);
    // A cancelled shakedown still protects p0 (design §9.7); as the next regular meeting would, lift it.
    expect(first.protected).toEqual(["p0"]);
    const second = passOnP0(opened({ ...first, protected: [] }, "p2"));
    expect(perks(second, "p0")).toEqual([]);
    expect(second.players.p0?.stash).toBe(6 + second.share);
  });

  it("a clean Shield holder isn't paid either (a cancel pays nobody)", () => {
    const open = opened(grantPerks(game(4), "p0", "shield"));
    expect(stashes(passOnP0(open))).toEqual(stashes(open));
  });

  it("not spent when the shakedown doesn't pass, or targets someone else", () => {
    const open = opened(grantPerks(withStash(game(4), "p0", 6), "p0", "shield"));
    const skipped = run(open, vote("p1", null), vote("p2", null), vote("p3", "p0"), CLOSE);
    expect(perks(skipped, "p0")).toEqual(["shield"]);
    const other = run(open, vote("p1", "p2"), vote("p0", "p2"), vote("p3", "p2"), CLOSE);
    expect(perks(other, "p0")).toEqual(["shield"]);
    expect(other.players.p0?.stash).toBe(open.players.p0?.stash);
  });
});
