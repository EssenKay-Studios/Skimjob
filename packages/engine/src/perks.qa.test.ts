// QA (PR #25, role deck v2 R1): perks — double spends, wrong phases, Shield vs
// Muscle vs a plain shakedown, +Vote stacking, Recharge on the Mole, a Rig spent
// at the act's meeting, view diffs while perks are held and spent, determinism.
// design §8.3 (docs/roles-v2.md §1), §11.2, §11.3
import { describe, expect, it } from "vitest";
import type { PerkId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { grantPerks } from "./perks.testkit";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "perk-qa",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: ["rookie", "lookout", "fence", "hacker"], // no Muscle: no shakedown window
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    ...extra,
  };
}
function game(players: number, roles: string[] = [], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  let seat = 0;
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "rookie" } : e)));
}
type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
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
const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const ALIBIS = (s: GameState) => ({ type: "advance", deadline: { kind: "alibis", round: s.resolvedRound } });
const SCHED = (s: GameState) => ({ type: "scheduleMeeting", act: Math.ceil(s.round / 3), slot: "x" });
const OPEN = (s: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting?.meetingId } });
const emergency = (by: string) => [{ type: "callEmergency", player: by }, { type: "advance", deadline: { kind: "openMeeting", meetingId: `emergency-${by}` } }];
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const RESOLVE = (s: GameState) => ({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.pendingShakedown?.meetingId } });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: target ? { kind: "shakedown", target } : { kind: "skip" } });
const perks = (s: GameState, id: string): readonly PerkId[] => (s.players[id] as PlayerState).roleState.perks;
const withStash = (s: GameState, id: string, stash: number): GameState => ({ ...s, players: { ...s.players, [id]: { ...(s.players[id] as PlayerState), stash } } });
const closed = (s: GameState) => s.log.filter((e) => e.type === "meetingClosed").at(-1);

/** Each spendable perk: the state it can be spent in, and the spend. */
const SPENDS: readonly [PerkId, () => GameState, object][] = [
  ["peek", () => game(4), { kind: "peek", target: "p1" }],
  ["tail", () => game(4), { kind: "tail", room: "vault" }],
  ["extraVote", () => run(game(4), ...emergency("p1")), { kind: "extraVote" }],
  ["ballot", () => run(game(4), ...emergency("p1")), { kind: "ballot", target: "p1" }],
  ["alibi", () => run(game(4), mv("p0", "office"), ROUND, { type: "postAlibi", player: "p0", room: "office" }), { kind: "alibi" }],
  ["recharge", () => run(game(4, ["hacker"]), mv("p0", "lobby", 0, { ability: { kind: "loopCameras", room: "vault" } }), ROUND, ALIBIS), { kind: "recharge" }],
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
    const pool = { rolePool: ["rookie", "muscle"] };
    const s = grantPerks(game(4, ["rookie", "muscle"], pool), "p0", "tail");
    const tail = use("p0", { kind: "tail", room: "vault" });
    expect(refused(run(s, ROUND), tail)).toMatch(/being planned/);
    expect(refused(run(s, ...emergency("p1")), tail)).toMatch(/being planned/);
    const pending = run(s, ...emergency("p1"), vote("p1", "p2"), vote("p2", "p3"), vote("p3", "p2"), vote("p0", "p2"), CLOSE);
    expect(pending.phase.kind).toBe("shakedownPending");
    expect(refused(pending, tail)).toMatch(/being planned/);
  });

  it("+Vote and Ballot are refused once the vote is tallied (shakedown window) and in the alibis", () => {
    const pool = { rolePool: ["rookie", "muscle"] };
    const s = grantPerks(game(4, ["rookie", "muscle"], pool), "p0", "extraVote", "ballot");
    const pending = run(s, ...emergency("p1"), vote("p1", "p2"), vote("p2", "p3"), vote("p3", "p2"), vote("p0", "p2"), CLOSE);
    for (const st of [pending, run(s, ROUND)]) {
      expect(refused(st, use("p0", { kind: "extraVote" }))).toMatch(/meeting is open/);
      expect(refused(st, use("p0", { kind: "ballot", target: "p1" }))).toMatch(/meeting is open/);
    }
    expect(perks(pending, "p0")).toEqual(["extraVote", "ballot"]);
  });

  it("no perk can be spent once the game is over", () => {
    const s = grantPerks(game(4), "p0", "peek");
    const over = run({ ...s, heat: 99 }, mv("p0", "vault"), mv("p1", "vault"), mv("p2", "vault"), mv("p3", "vault"), ROUND);
    expect(over.phase.kind).toBe("ended");
    expect(refused(over, use("p0", { kind: "peek", target: "p1" }))).toMatch(/over/);
  });

  it("Rig: refused with no next card (last round), allowed for round 2 from round 1", () => {
    const s = grantPerks(game(4, [], { eventsEnabled: true }), "p0", "rig");
    expect(refused({ ...s, round: 9 }, use("p0", { kind: "rig" }))).toMatch(/no next event card/);
    expect(since(s, run(s, use("p0", { kind: "rig" })))[0]).toMatchObject({ type: "perkUsed", perk: { kind: "rig", round: 2 } });
  });
});

describe("QA: Shield vs Muscle vs a plain shakedown — design §8.3, §11.3", () => {
  const passOnP0 = (s: GameState, by = "p1") => run(s, ...emergency(by), vote("p1", "p0"), vote("p2", "p0"), vote("p3", "p0"), CLOSE);

  it("plain: the stash goes to the Haul; Shield: stash kept, Haul unchanged, no compensation, one Shield per passed shakedown", () => {
    const base = withStash(game(4), "p0", 6);
    const plain = passOnP0(base);
    expect(plain.players.p0?.stash).toBe(0);
    expect(plain.haul).toBe(base.haul + 6);

    const two = grantPerks(base, "p0", "shield", "shield");
    const first = passOnP0(two);
    expect(first.players.p0).toMatchObject({ stash: 6, timesShakenDown: 0 });
    expect(first.haul).toBe(base.haul);
    expect(Object.fromEntries(Object.entries(first.players).map(([id, p]) => [id, p.stash]))).toEqual(
      Object.fromEntries(Object.entries(two.players).map(([id, p]) => [id, p.stash])),
    );
    expect(perks(first, "p0")).toEqual(["shield"]);
    const second = passOnP0(first, "p2");
    expect(perks(second, "p0")).toEqual([]);
    expect(second.players.p0?.stash).toBe(6);
  });

  it("a clean Shield holder gets no compensation either (nobody pays out for a cancel)", () => {
    const s = grantPerks(game(4), "p0", "shield");
    const after = passOnP0(s);
    expect(Object.values(after.players).map((p) => p.stash)).toEqual(Object.values(s.players).map((p) => p.stash));
  });

  it("not spent when the shakedown doesn't pass, or targets someone else", () => {
    const s = grantPerks(withStash(game(4), "p0", 6), "p0", "shield");
    const skipped = run(s, ...emergency("p1"), vote("p1", null), vote("p2", null), vote("p3", "p0"), CLOSE);
    expect(perks(skipped, "p0")).toEqual(["shield"]);
    const other = run(s, ...emergency("p1"), vote("p1", "p2"), vote("p0", "p2"), vote("p3", "p2"), CLOSE);
    expect(perks(other, "p0")).toEqual(["shield"]);
    expect(other.players.p0?.stash).toBe(6);
  });

  it("a bystander can't tell a Shield cancel from a Muscle cancel (same ledger, same case file)", () => {
    const pool = { rolePool: ["rookie", "muscle"] };
    const base = withStash(game(4, ["rookie", "muscle"], pool), "p0", 6);
    const pending = (s: GameState) => run(s, ...emergency("p2"), vote("p1", "p0"), vote("p2", "p0"), vote("p3", "p0"), CLOSE);
    const byShield = run(pending(grantPerks(base, "p0", "shield")), RESOLVE);
    const byMuscle = run(pending(base), use("p1", { kind: "cancelShakedown" }), RESOLVE);
    for (const st of [byShield, byMuscle]) expect(st.log.some((e) => e.type === "shakedownCancelled")).toBe(true);
    for (const viewer of ["p2", "p3"]) {
      const a = viewFor(byShield, viewer);
      const b = viewFor(byMuscle, viewer);
      expect(a.ledger).toEqual(b.ledger);
      expect(a.caseFile).toEqual(b.caseFile);
    }
  });
});

describe("QA: +Vote, Recharge, Rig at the meeting — design §8.3", () => {
  it("+Vote stacks with the Smooth talker's double vote (weight 3)", () => {
    const s = run(grantPerks(game(6, ["smoothTalker"], { rolePool: ["rookie", "smoothTalker"] }), "p0", "extraVote"), ...emergency("p0"));
    const votes = [vote("p0", "p5"), vote("p1", null), vote("p2", null), vote("p3", null)];
    // 2 vs 3: skipped; 3 vs 3: no majority either way.
    expect(closed(run(s, ...votes, CLOSE))).toMatchObject({ result: { kind: "skipped" } });
    expect(closed(run(s, use("p0", { kind: "extraVote" }), ...votes, CLOSE))).toMatchObject({ result: { kind: "noMajority" } });
    expect(closed(run(s, use("p0", { kind: "extraVote" }), ...votes.slice(0, 3), CLOSE))).toMatchObject({ result: { kind: "shakedown", target: "p5" } });
  });

  it("Recharge gives the Mole a second tip-off in the same act", () => {
    const TIP = { ability: { kind: "tipOff" } };
    let s = grantPerks(game(4, ["mole"]), "p0", "recharge");
    s = run(s, mv("p0", "lobby", 0, TIP), ROUND, ALIBIS);
    expect(refused(s, mv("p0", "lobby", 0, TIP))).toBeTruthy();
    s = run(s, use("p0", { kind: "recharge" }), mv("p0", "lobby", 0, TIP), ROUND);
    expect(s.log.filter((e) => e.type === "abilityResolved" && e.ability.kind === "tipOff")).toHaveLength(2);
  });

  it("a Rig spent at the act's meeting picks Act 2's first card, flipped when the meeting ends", () => {
    let s = grantPerks(game(4, [], { eventsEnabled: true }), "p0", "rig");
    for (let r = 0; r < 3; r++) s = run({ ...s, heat: 0 }, ROUND, ALIBIS);
    s = run({ ...s, heat: 0, haul: 10_000 }, SCHED, OPEN, use("p0", { kind: "rig" }));
    const spent = [...s.log].reverse().find((e) => e.type === "perkUsed");
    if (spent?.type !== "perkUsed" || spent.perk.kind !== "rig") throw new Error("no Rig");
    expect(spent.perk.round).toBe(4);
    const pick = spent.perk.cards[1] as string;
    const next = run(s, use("p0", { kind: "rigPick", card: pick }), CLOSE);
    expect(next.round).toBe(4);
    expect(next.card?.id).toBe(pick);
    expect(next.rig).toBeNull();
  });
});

describe("QA: perks never leak to other views — design §8.3, §17.2", () => {
  it("holding and spending Peek, Tail, Rig, rigPick, Recharge, +Vote and Ballot change no other player's view", () => {
    let s = grantPerks(game(4, ["hacker"], { eventsEnabled: true, voteVisibility: "secret" }), "p0", "peek", "tail", "rig", "recharge", "extraVote", "ballot");
    const others = ["p1", "p2", "p3"];
    const views = (st: GameState) => others.map((id) => JSON.stringify(viewFor(st, id)));
    const check = (before: GameState, ...cmds: Cmd[]): GameState => {
      const after = run(before, ...cmds);
      expect(views(after)).toEqual(views(before));
      return after;
    };
    s = check(s, use("p0", { kind: "peek", target: "p1" }));
    s = check(s, use("p0", { kind: "tail", room: "vault" }));
    s = check(s, use("p0", { kind: "rig" }));
    const rig = s.rig;
    if (!rig) throw new Error("no rig");
    s = check(s, use("p0", { kind: "rigPick", card: rig.cards[1] }));
    s = run(s, mv("p0", "lobby", 0, { ability: { kind: "loopCameras", room: "vault" } }), ROUND, ALIBIS);
    s = check(s, use("p0", { kind: "recharge" }));
    s = run(s, ...emergency("p1"), vote("p1", "p2"));
    s = check(s, use("p0", { kind: "extraVote" }));
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
      let s = grantPerks(game(5, ["lookout"], { eventsEnabled: true }), "p0", "rig", "tail", "peek", "ballot", "shield");
      s = run(s, use("p0", { kind: "rig" }), use("p0", { kind: "tail", room: "vault" }), use("p0", { kind: "peek", target: "p3" }));
      s = run(s, mv("p0", "lobby"), mv("p1", "vault", 2), mv("p2", "vault"), ROUND, ALIBIS);
      s = run(s, ...emergency("p1"), use("p0", { kind: "ballot", target: "p1" }), vote("p1", "p0"), vote("p2", "p0"), vote("p3", "p0"), vote("p4", "p0"), CLOSE);
      return s;
    };
    const a = script();
    const b = script();
    expect(b.log).toEqual(a.log);
    expect(a.log.some((e) => e.type === "perkUsed" && e.perk.kind === "shield")).toBe(true);
    expect(replay(a.config, a.log)).toEqual(a);
  });
});
