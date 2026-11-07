// Bells, rings, raids, Wanted, the bust with the Rooftop escape, and cooling;
// the Mole's ring and the Fixer's reopen that act on them.
// design §4.2 (end-of-round order), §5.1–§5.6, §11.1
import { describe, expect, it } from "vitest";
import { BANK_JOB, FACTS } from "@skimjob/content";
import { handleThroughAlibis } from "./alibis.testkit";
import type { Command, GameConfig, GameEvent, GameState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { coolBells, factVisibility, ringBells } from "./bells";

function config(players: number, contentOverrides: GameConfig["contentOverrides"] = null): GameConfig {
  return {
    seed: "bells-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: ["rookie", "mole", "fixer"],
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    contentOverrides,
  };
}

/** A new game with seat i dealt roles[i] (Rookie if missing). */
function game(players: number, roles: string[] = [], contentOverrides: GameConfig["contentOverrides"] = null): GameState {
  const cfg = config(players, contentOverrides);
  let seat = 0;
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "rookie" } : e)));
}

function run(state: GameState, ...commands: unknown[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughAlibis(s, typeof c === "function" ? c(s) : c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    return r.state;
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const r = handleCommand(state, command);
  if (r.ok) throw new Error("expected a rejection");
  return r.reason;
}

const mv = (player: string, room: string, duffel = 0, pocket = 0, extra: object = {}): Command =>
  ({ type: "submitMove", player, move: { room, duffel, pocket, ...extra } }) as Command;
const ROUND = (s: GameState): Command => ({ type: "advance", deadline: { kind: "round", round: s.round } });
/** The events of the latest round's resolution (from its `bellsRung` on). */
const lastRound = (s: GameState): GameEvent[] => s.log.slice(s.log.map((e) => e.type).lastIndexOf("bellsRung"));
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) => events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const rung = (s: GameState) => ofType(lastRound(s), "bellsRung")[0]?.bells;
const PUBLIC = { kind: "public" };

describe("rings light bulbs — design §5.1, §5.2, §4.2 step 2", () => {
  it("every bell starts dark, one per room in play, public in every view", () => {
    const s = game(3);
    expect(s.bells).toEqual({ vault: 0, office: 0, lobby: 0, security: 0, rooftop: 0 });
    for (const id of s.playerOrder) expect(viewFor(s, id)).toMatchObject({ bells: s.bells, taped: {}, wanted: 0 });
  });

  it("each noisy coin rings once and the rings in a room add up; the Lobby is silent, the Office's 1st coin too, every Vault coin rings", () => {
    const s = run(game(5), mv("p0", "vault", 1), mv("p1", "vault", 0, 2), mv("p2", "office", 2), mv("p3", "lobby", 1), mv("p4", "depositBoxes", 1), ROUND);
    expect(rung(s)).toEqual({ vault: 3, office: 1, lobby: 0, security: 0, rooftop: 0, depositBoxes: 0, serverRoom: 0 });
  });

  it("the bells are a public fact, from the content fact catalogue (design §19 seam 1)", () => {
    expect(FACTS.bells).toBe("public");
    expect(factVisibility("bells")).toEqual(PUBLIC);
    const s = run(game(3), mv("p0", "vault", 2), ROUND);
    const [event] = ofType(lastRound(s), "bellsRung");
    expect(event).toEqual({ type: "bellsRung", visibility: PUBLIC, round: 1, bells: { vault: 2, office: 0, lobby: 0, security: 0, rooftop: 0 } });
    for (const id of s.playerOrder) expect(viewFor(s, id).ledger.map((e) => e.event)).toContainEqual(event);
  });

  it("rings count the coins actually grabbed: a short bank's cut rings less (design §3.2)", () => {
    // A bank of 3 (1 a player): three Vault grabs of 3 get one coin each.
    const s = run(game(3, [], { bank: { coinsPerPlayer: 1 } }), mv("p0", "vault", 3), mv("p1", "vault", 3), mv("p2", "vault", 3), ROUND);
    expect(ofType(s.log, "coinsGrabbed").map((e) => e.duffel)).toEqual([1, 1, 1]);
    expect(rung(s)?.vault).toBe(3);
  });

  it("a bell never shows more bulbs than it has (the extra rings raid it, §5.3)", () => {
    expect(ringBells(["vault", "office"], { vault: 3, office: 0 }, new Map([["vault", 5]]), 4)).toEqual({ vault: 4, office: 0 });
    // A room with no bell (taped off) is never rung.
    expect(ringBells(["vault", "office"], { office: 1 }, new Map([["vault", 2], ["office", 1]]), 4)).toEqual({ office: 2 });
  });
});

describe("cooling — design §5.6, §4.2 step 6", () => {
  it("every room turns off 1 bulb, never below 0, after the round's rings", () => {
    const s = run(game(3), mv("p0", "vault", 2), mv("p1", "office", 2), ROUND);
    expect(rung(s)).toMatchObject({ vault: 2, office: 1, lobby: 0 });
    expect(ofType(lastRound(s), "bellsCooled")).toEqual([{ type: "bellsCooled", visibility: PUBLIC, round: 1, bells: { vault: 1, office: 0, lobby: 0, security: 0, rooftop: 0 } }]);
    expect(s.bells).toEqual({ vault: 1, office: 0, lobby: 0, security: 0, rooftop: 0 });
  });

  it("each Rooftop player cools the hottest room by 1 more, one after another, each time the hottest at that moment", () => {
    // Vault 3, Office 1 → after −1: Vault 2, Office 0 → two on the Rooftop: Vault 1, then Vault 0.
    const s = run(game(4), mv("p0", "vault", 3), mv("p1", "office", 2), mv("p2", "rooftop"), mv("p3", "rooftop"), ROUND);
    expect(rung(s)).toMatchObject({ vault: 3, office: 1 });
    expect(s.bells).toMatchObject({ vault: 0, office: 0 });
    // Vault 4, Office 1 → 3, 0 → three Rooftop players: 2, 1, 0; nothing goes below 0.
    expect(coolBells(["vault", "office"], { vault: 4, office: 1 }, 3, { int: () => 0, pick: (x) => x[0] as never, shuffle: (x) => [...x] })).toEqual({ vault: 0, office: 0 });
  });

  it("ties for the hottest are broken with the game's seeded randomness; no tie, no draw (design §5.6)", () => {
    const tied = run(game(4), mv("p0", "vault", 2), mv("p1", "office", 2), mv("p2", "office", 2), mv("p3", "rooftop"));
    const before = tied.log.length;
    const s = run(tied, ROUND);
    // Vault 2, Office 2 → 1 and 1: the Rooftop player cools one of them, drawn.
    const cooled = ofType(lastRound(s), "bellsCooled")[0]?.bells;
    expect([cooled?.vault, cooled?.office].sort()).toEqual([0, 1]);
    expect(s.log.slice(before).some((e) => e.type === "rngAdvanced")).toBe(true);
    // Same seed, same commands, same pick.
    expect(run(tied, ROUND).log).toEqual(s.log);
    // A clear hottest room draws nothing.
    const clear = run(game(4), mv("p0", "vault", 3), mv("p1", "office", 2), mv("p2", "lobby", 1), mv("p3", "rooftop"));
    const n = clear.log.length;
    expect(run(clear, ROUND).log.slice(n).some((e) => e.type === "rngAdvanced")).toBe(false);
  });

  it("nobody on the Rooftop cools nothing extra; dark bells stay dark", () => {
    expect(coolBells(["vault", "office"], { vault: 0, office: 0 }, 5, { int: () => 0, pick: () => { throw new Error("no draw") }, shuffle: (x) => [...x] })).toEqual({ vault: 0, office: 0 });
  });
});

describe("raids — design §5.3, §4.2 step 3", () => {
  /** Round 1: p0 and p1 grab 3 and 2 in the Vault (5 rings ≥ 4 bulbs); p2 hands 2 in from the Office. */
  const raided = () => run(game(3), mv("p0", "vault", 1, 2), mv("p1", "vault", 2), mv("p2", "office", 2), ROUND);

  it("the 4th bulb raids the room: its visitors' grabs are seized before the split, everyone else's stands", () => {
    const s = raided();
    expect(ofType(lastRound(s), "coinsGrabbed").map((e) => [e.player, e.duffel, e.pocket, e.seized])).toEqual([
      ["p0", 0, 0, 3],
      ["p1", 0, 0, 2],
      ["p2", 2, 0, 0],
    ]);
    // Seized coins are never handed in or pocketed, and they left the bank. design §5.3, §6.1, §7.6
    expect([s.players.p0?.stash, s.players.p0?.totalHandedIn, s.haul, s.bank, s.seized]).toEqual([0, 0, 2, 48 - 7, 5]);
    expect(ofType(lastRound(s), "roundResolved")[0]).toMatchObject({ haulDelta: 2, bank: 41 });
  });

  it("is public, without who was inside: the room, the coins seized, CLOSED through round 3, Wanted 1", () => {
    const s = raided();
    const [raid] = ofType(s.log, "roomRaided");
    expect(raid).toEqual({ type: "roomRaided", visibility: PUBLIC, round: 1, room: "vault", seized: 5, closedThrough: 3, wanted: 1 });
    expect([s.taped, s.wanted]).toEqual([{ vault: 3 }, 1]);
    for (const id of s.playerOrder) expect(viewFor(s, id)).toMatchObject({ taped: { vault: 3 }, wanted: 1 });
  });

  it("a taped-off room's bell is off: not shown, nobody can pick it for 2 rounds, then it reopens at 0", () => {
    let s = raided();
    expect(Object.hasOwn(s.bells, "vault")).toBe(false);
    expect(Object.hasOwn(viewFor(s, "p2").bells, "vault")).toBe(false);
    expect(reason(s, mv("p0", "vault", 1))).toMatch(/taped off/);
    s = run(s, ROUND); // round 2
    expect(s.round).toBe(3);
    expect(reason(s, mv("p0", "vault", 1))).toMatch(/taped off/);
    s = run(s, ROUND); // round 3: the Act 1 meeting is due; open round 4
    s = run(s, { type: "scheduleMeeting", act: 1, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } }, { type: "advance", deadline: { kind: "closeMeeting", meetingId: "act-1" } });
    expect(s.round).toBe(4);
    expect([s.taped, s.bells.vault]).toEqual([{}, 0]);
    expect(ofType(lastRound(run(s, mv("p0", "vault", 1), ROUND)), "coinsGrabbed")[0]).toMatchObject({ player: "p0", room: "vault", duffel: 1, seized: 0 });
  });

  it("raids come before cooling: the Rooftop can't save a room in the same round (design §4.2)", () => {
    const s = run(game(4), mv("p0", "vault", 3), mv("p1", "vault", 1), mv("p2", "rooftop"), mv("p3", "rooftop"), ROUND);
    expect(ofType(s.log, "roomRaided").map((e) => e.room)).toEqual(["vault"]);
  });

  it("two raids in one round raise Wanted twice (design §5.4)", () => {
    // Vault: 3 + 1 rings; Deposit boxes: four grabs of 2 ring once each.
    const both = run(game(6), mv("p0", "vault", 3), mv("p1", "vault", 1), ...["p2", "p3", "p4", "p5"].map((p) => mv(p, "depositBoxes", 2)), ROUND);
    expect(ofType(both.log, "roomRaided").map((e) => [e.room, e.seized, e.wanted])).toEqual([["vault", 4, 1], ["depositBoxes", 8, 2]]);
    expect([both.wanted, both.taped]).toEqual([2, { vault: 3, depositBoxes: 3 }]);
  });

  it("Wanted never goes down (design §5.4)", () => {
    let s = raided();
    for (let i = 0; i < 2; i++) s = run(s, ROUND);
    expect(s.wanted).toBe(1);
  });

  it("the bell size, the tape and the bust line are content numbers [tunable] (design §5.1, §5.3, §5.5)", () => {
    expect(BANK_JOB.alarm).toEqual({ bulbs: 4, tapedRounds: 2, bustStars: 3 });
    const s = run(game(3, [], { alarm: { bulbs: 2, tapedRounds: 1 } }), mv("p0", "vault", 2), ROUND);
    expect(ofType(s.log, "roomRaided")[0]).toMatchObject({ room: "vault", seized: 2, closedThrough: 2 });
  });
});

describe("the bust and the Rooftop escape — design §5.5, §4.2 step 4, §8.3", () => {
  /** Wanted 2, then a Vault raid in round 1: p0 and p1 grab in the Vault, p2 lies low on the Rooftop. */
  const busted = (roles: string[] = [], stash: Record<string, number> = {}) => {
    const g = game(3, roles);
    const players = Object.fromEntries(Object.entries(g.players).map(([id, p]) => [id, { ...p, stash: stash[id] ?? 0 }]));
    return run({ ...g, wanted: 2, players }, mv("p0", "vault", 2, 1), mv("p1", "vault", 1), mv("p2", "rooftop"), ROUND);
  };

  it("Wanted 3 ends the game at once: no cooling, no alibi window; only the Rooftop escapes", () => {
    const s = busted();
    expect(s.wanted).toBe(3);
    expect(s.phase).toMatchObject({ kind: "ended", outcome: { result: "failed", reason: "bust", escapees: ["p2"], winners: ["p2"] } });
    expect(ofType(lastRound(s), "bellsCooled")).toEqual([]);
    expect(s.alibisOpen).toBe(false);
    expect(s.log.at(-1)?.type).toBe("gameEnded");
    expect(handleCommand(s, mv("p0", "lobby", 1))).toEqual({ ok: false, reason: "the game is over" });
  });

  it("a bust on a meeting's last round ends the game instead of waiting for the meeting", () => {
    // Rounds 1–2 in the Lobby (silent), then the 4th Vault bulb in round 3 at Wanted 2.
    const lobby = [mv("p0", "lobby", 1), mv("p1", "lobby", 1), mv("p2", "lobby", 1), ROUND];
    const s = run({ ...run(game(3), ...lobby, ...lobby), wanted: 2 }, mv("p0", "vault", 3), mv("p1", "vault", 1), mv("p2", "lobby", 1), ROUND);
    expect(s.wanted).toBe(3);
    expect(s.phase).toMatchObject({ kind: "ended", outcome: { reason: "bust" } });
    expect(ofType(s.log, "roundStarted").map((e) => e.round)).toEqual([1, 2, 3]);
  });

  it("the biggest stash among the escapees wins, every escapee tied for it, any role (the Mole included)", () => {
    const hot = (g: GameState): GameState => ({ ...g, wanted: 2, bells: { ...g.bells, vault: 1 } });
    const s = run(hot(game(4, ["mole"])), mv("p0", "rooftop"), mv("p1", "rooftop"), mv("p2", "vault", 3), mv("p3", "rooftop"), ROUND);
    expect(s.phase).toMatchObject({ outcome: { reason: "bust", escapees: ["p0", "p1", "p3"], winners: ["p0", "p1", "p3"] } });
    const rich = (stash: Record<string, number>) => {
      const g = game(4, ["mole"]);
      const players = Object.fromEntries(Object.entries(g.players).map(([id, p]) => [id, { ...p, stash: stash[id] ?? 0 }]));
      return run(hot({ ...g, players }), mv("p0", "rooftop"), mv("p1", "rooftop"), mv("p2", "vault", 3), mv("p3", "lobby", 1), ROUND);
    };
    // The arrested p2 and p3 can't win, however big their stash.
    expect(rich({ p0: 5, p1: 2, p2: 9, p3: 9 }).phase).toMatchObject({ outcome: { escapees: ["p0", "p1"], winners: ["p0"] } });
    expect(rich({ p0: 5, p1: 5, p2: 9 }).phase).toMatchObject({ outcome: { winners: ["p0", "p1"] } });
  });

  it("nobody on the Rooftop: nobody wins; the ranking still shows every stash", () => {
    const g = game(3);
    const s = run({ ...g, wanted: 2, bells: { ...g.bells, vault: 1 } }, mv("p0", "vault", 3), mv("p1", "lobby", 0, 1), mv("p2", "office", 0, 2), ROUND);
    expect(s.phase).toMatchObject({ kind: "ended", outcome: { reason: "bust", escapees: [], winners: [] } });
    if (s.phase.kind !== "ended") throw new Error("not ended");
    expect(s.phase.outcome.ranking.map((r) => [r.player, r.stash])).toEqual([["p2", 2], ["p1", 1], ["p0", 0]]);
  });

  it("escapees keep only the stash they already had: this round's grab in a raided room is seized", () => {
    const s = busted([], { p0: 4, p2: 1 });
    expect(s.players.p0?.stash).toBe(4);
    expect(s.phase).toMatchObject({ outcome: { escapees: ["p2"], winners: ["p2"] } });
  });

  it("the Rooftop is never raided: nothing grabs there and nothing rings it (design §5.5, §11.1)", () => {
    const s = run(game(12), ...Array.from({ length: 12 }, (_, i) => mv(`p${i}`, "rooftop")), ROUND);
    expect([rung(s)?.rooftop, s.wanted]).toEqual([0, 0]);
  });

  it("replays and is deterministic", () => {
    const s = busted();
    expect(replay(s.config, s.log)).toEqual(s);
  });
});

describe("the Mole's ring — design §5.2, §5.3, §11.1", () => {
  const RING = (room: string) => mv("p0", "lobby", 1, 0, { ability: { kind: "ring", room } });

  it("rings any open room once, like an ordinary ring; only the Mole is told", () => {
    const s = run(game(3, ["mole"]), RING("office"), mv("p1", "office", 2), ROUND);
    expect(rung(s)?.office).toBe(2);
    const used = ofType(s.log, "abilityResolved");
    expect(used).toEqual([{ type: "abilityResolved", visibility: { kind: "private", player: "p0" }, player: "p0", round: 1, ability: { kind: "ring", room: "office" } }]);
    expect(viewFor(s, "p1").caseFile.some((e) => e.event.type === "abilityResolved")).toBe(false);
  });

  it("can cause a raid (the 4th bulb), at once", () => {
    const s = run(game(3, ["mole"]), RING("vault"), mv("p1", "vault", 3), ROUND);
    expect(ofType(s.log, "roomRaided")).toMatchObject([{ room: "vault", seized: 3, wanted: 1 }]);
  });

  it("not the Rooftop, not a taped-off room, not a room out of play; once between meetings", () => {
    const g = game(3, ["mole"]);
    expect(reason(g, RING("rooftop"))).toMatch(/Rooftop/);
    expect(reason(g, RING("managersOffice"))).toMatch(/in play/);
    expect(reason(g, RING("__proto__"))).toMatch(/in play/);
    expect(reason({ ...g, taped: { office: 2 } }, RING("office"))).toMatch(/off/);
    const once = run(g, RING("office"), ROUND);
    expect(reason(once, RING("office"))).toMatch(/already rung/);
    // Not a power of anyone else.
    expect(reason(g, mv("p1", "lobby", 1, 0, { ability: { kind: "ring", room: "office" } }))).toMatch(/no ring ability/);
  });
});

describe("the Fixer's reopen — design §5.3, §11.1", () => {
  /** Round 1: the Vault is raided (p1 grabs 3, p2 grabs 1); p0 is the Fixer. */
  const taped = () => run(game(3, ["fixer"]), mv("p0", "lobby", 1), mv("p1", "vault", 3), mv("p2", "vault", 1), ROUND);
  const REOPEN = (room: string) => mv("p0", "lobby", 1, 0, { ability: { kind: "reopen", room } });

  it("tears the tape off a taped-off room: public, without a name; the room is open next round, its bell at 0", () => {
    const before = taped();
    const s = run(before, REOPEN("vault"), ROUND);
    expect(ofType(lastRound(s), "roomReopened")).toEqual([{ type: "roomReopened", visibility: PUBLIC, round: 2, room: "vault" }]);
    expect(ofType(s.log.slice(before.log.length), "abilityResolved")).toEqual([{ type: "abilityResolved", visibility: { kind: "private", player: "p0" }, player: "p0", round: 2, ability: { kind: "reopen", room: "vault" } }]);
    expect([s.round, s.taped, s.bells.vault]).toEqual([3, {}, 0]);
    expect(ofType(lastRound(run(s, mv("p1", "vault", 1), ROUND)), "coinsGrabbed").find((e) => e.player === "p1")).toMatchObject({ room: "vault", duffel: 1, seized: 0 });
  });

  it("once per game, and only a taped-off room", () => {
    expect(reason(game(3, ["fixer"]), REOPEN("vault"))).toMatch(/taped-off room/);
    const s = run(taped(), REOPEN("vault"), ROUND);
    expect(reason({ ...s, taped: { office: 5 } }, REOPEN("office"))).toMatch(/already reopened/);
    expect(reason(taped(), mv("p1", "lobby", 1, 0, { ability: { kind: "reopen", room: "vault" } }))).toMatch(/no reopen ability/);
  });
});

describe("a missed move into a taped-off default room — design §3.3, §5.3 (provisional)", () => {
  it("lies low on the Rooftop instead of entering the closed Lobby", () => {
    const s = run({ ...game(3), taped: { lobby: 2 }, bells: { vault: 0, office: 0, security: 0, rooftop: 0 } }, mv("p0", "office", 1), mv("p1", "office", 1));
    const after = run(s, ROUND);
    expect(ofType(after.log, "defaultMoveAssigned")).toMatchObject([{ player: "p2", move: { room: "rooftop", duffel: 0, pocket: 0 } }]);
  });
});
