// QA (PR #166, S3a.3): the bank, the round cap and the endings, adversarially.
// The game ends exactly when the bank empties (a short last round too), at the
// round cap, or on a bust, with a bust winning when two land in one round; the
// honesty line at and one coin under it; sunk by theft with Mole ties; §8.5
// ties; conservation; 3 and 12 players; commands after the end; determinism;
// what viewFor shows before and after the end. design §4.2, §5.5, §6, §7.5, §7.7, §8
import { describe, expect, it } from "vitest";
import type { ContentOverrides, GameConfig, GameEvent, GameState, Outcome, PlayerState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { handleThroughAlibis } from "./alibis.testkit";
import { NO_RAIDS } from "./v01-numbers.testkit";
import { viewFor } from "./view";

function config(players: number, overrides?: ContentOverrides, seed = "qa166"): GameConfig {
  return {
    seed,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: ["lookout"],
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...(overrides && { contentOverrides: overrides }),
  };
}

/** Seat i is dealt roles[i] (Rookie if missing). */
function game(players: number, roles: string[] = [], overrides?: ContentOverrides, seed?: string): GameState {
  const cfg = config(players, overrides, seed);
  let seat = 0;
  const log = setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "rookie" } : e));
  return replay(cfg, log);
}

const start = (s: GameState): number => (s.log.find((e) => e.type === "bankFilled") as { coins: number }).coins;
const stashes = (s: GameState): number => Object.values(s.players).reduce((n, p) => n + p.stash, 0);

/** design §7.7 as it stands before S3a.4 (no perks or shakedowns here): bank + Haul + stashes + seized = the start. */
function conserved(s: GameState): void {
  expect(s.bank + s.haul + stashes(s) + s.seized, `round ${s.round}`).toBe(start(s));
  expect(s.bank).toBeGreaterThanOrEqual(0);
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughAlibis(s, typeof c === "function" ? c(s) : c);
    if (!r.ok) throw new Error(`rejected: ${r.reason}`);
    conserved(r.state);
    return r.state;
  }, state);
}

const mv = (player: string, room: string, duffel: number, pocket = 0) => ({ type: "submitMove", player, move: { room, duffel, pocket } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const sched = (act: number) => ({ type: "scheduleMeeting", act, slot: "slot" });
const OPEN = (s: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting?.meetingId } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const meeting = (s: GameState): GameState => run(s, sched(s.round / 3), OPEN, CLOSE);

/** One round: `moves[i]` is seat i's [room, duffel, pocket]. */
const round = (s: GameState, moves: [string, number, number?][]): GameState => run(s, ...moves.map(([room, d, p], i) => mv(`p${i}`, room, d, p ?? 0)), ROUND);
/** Every seat in the Vault, a full grab (3), `pockets[i]` of it pocketed. */
const vault = (s: GameState, pockets: number[]): GameState => round(s, pockets.map((p): [string, number, number] => ["vault", 3 - p, p]));
const all = <T>(n: number, x: T): T[] => Array.from({ length: n }, () => x);

const outcome = (s: GameState): Outcome => {
  if (s.phase.kind !== "ended") throw new Error(`game not over (${s.phase.kind})`);
  return s.phase.outcome;
};
const endings = (s: GameState) => s.log.filter((e) => e.type === "gameEnded");
const withPlayers = (s: GameState, change: Record<string, Partial<PlayerState>>): GameState => ({
  ...s,
  players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, ...change[id] }])),
});

describe("the bank empties — design §6.1, §6.2, §3.2", () => {
  it("12 players: a short last round (12 of 36 asked) empties the bank and ends the game at once, mid-act", () => {
    let s = game(12, [], NO_RAIDS); // 192 coins, 36 a round
    for (let r = 1; r <= 5; r++) {
      s = vault(s, all(12, 0));
      expect(s.phase.kind, `round ${r}`).not.toBe("ended");
      if (r === 3) s = meeting(s);
    }
    expect(s.bank).toBe(12);
    s = vault(s, all(12, 0));
    expect(s.bank).toBe(0);
    expect(s.round).toBe(6);
    const r6 = s.log.filter((e) => e.type === "coinsGrabbed" && e.round === 6) as Extract<GameEvent, { type: "coinsGrabbed" }>[];
    expect(r6.reduce((n, e) => n + e.duffel + e.pocket + e.seized, 0)).toBe(12);
    // Round 6 ends an act, but no meeting follows the last round (§6.2) and nothing after the end check runs (§4.2 step 8).
    const tail = s.log.slice(s.log.findIndex((e) => e.type === "roundResolved" && e.round === 6)).map((e) => e.type).filter((t) => t !== "rngAdvanced");
    expect(tail).toEqual(["roundResolved", "gameEnded"]);
    expect(outcome(s)).toMatchObject({ result: "success" });
    expect(outcome(s).winners).toHaveLength(12); // every stash 0: the whole crew (§8.2)
  });

  it("a short last round cuts pocket-bound coins first, and the honesty check reads the coins actually taken (§3.2, §7.5)", () => {
    // 3 players × 4 = 12 coins. Round 1: 9 taken, all handed in. Round 2: 3 left, each asks 1 duffel + 2 pocket.
    let s = vault(game(3, [], { ...NO_RAIDS, bank: { coinsPerPlayer: 4 } }), [0, 0, 0]);
    s = vault(s, [2, 2, 2]);
    expect(s.bank).toBe(0);
    // Read the result from the log: honesty = Haul ÷ 12 (nothing seized), success at or above 2/3.
    const grabs = s.log.filter((e) => e.type === "coinsGrabbed" && e.round === 2) as Extract<GameEvent, { type: "coinsGrabbed" }>[];
    expect(grabs.reduce((n, e) => n + e.duffel + e.pocket, 0)).toBe(3);
    expect(s.haul / 12 >= 2 / 3 ? "success" : "failed").toBe(outcome(s).result);
  });

  it("the round the bank empties is also the cap: one ending, not two", () => {
    const s = vault(game(3, [], { ...NO_RAIDS, bank: { coinsPerPlayer: 3 }, roundCap: 1 }), [0, 0, 0]);
    expect(s.bank).toBe(0);
    expect(endings(s)).toHaveLength(1);
    expect(outcome(s).result).toBe("success");
  });

  it("an empty bank ends the game even when every coin of the last round was seized", () => {
    // 3 × 2 = 6 coins; two Vault grabs take all 6, ring 6 and raid (4 bulbs). Nothing taken counts, so honesty reads full.
    const s = round(game(3, [], { bank: { coinsPerPlayer: 2 } }), [["vault", 3], ["vault", 3], ["rooftop", 0]]);
    expect(s.bank).toBe(0);
    expect(s.seized).toBe(6);
    expect(s.wanted).toBe(1);
    expect(outcome(s)).toMatchObject({ result: "success" });
  });
});

describe("the round cap — design §6.2", () => {
  it("12 players: the game ends after round 12 with the shipped numbers, no meeting after it; round 11 plays on", () => {
    let s = game(12); // 192 coins, 12 Lobby coins a round (silent)
    for (let r = 1; r <= 12; r++) {
      s = round(s, all(12, ["lobby", 1] as [string, number]));
      if (r < 12) expect(s.phase.kind, `round ${r}`).not.toBe("ended");
      if (r % 3 === 0 && r < 12) s = meeting(s);
    }
    expect(s.round).toBe(12);
    expect(s.bank).toBe(192 - 144);
    expect(s.log.filter((e) => e.type === "meetingOpened")).toHaveLength(3);
    expect(s.log.at(-1)?.type).toBe("gameEnded");
    expect(outcome(s)).toMatchObject({ result: "success" });
  });

  it("a cap that lands on a meeting round (3) ends the game with no meeting", () => {
    let s = game(3, [], { ...NO_RAIDS, roundCap: 3 });
    s = vault(s, [0, 0, 0]);
    s = vault(s, [0, 0, 0]);
    s = run(s, sched(1)); // a meeting scheduled for after round 3 never opens
    s = vault(s, [0, 0, 0]);
    expect(s.round).toBe(3);
    expect(s.bank).toBe(48 - 27);
    expect(s.log.some((e) => e.type === "meetingOpened")).toBe(false);
    expect(endings(s)).toHaveLength(1);
  });
});

describe("a bust wins over the bank and the cap in the same round — design §4.2 steps 4 and 8, §5.5", () => {
  it("the bust lands in the round that empties the bank: a bust, the Rooftop escapes", () => {
    const s = round(game(3, [], { bank: { coinsPerPlayer: 2 }, alarm: { bustStars: 1 } }), [["vault", 3], ["vault", 3], ["rooftop", 0]]);
    expect(s.bank).toBe(0);
    expect(endings(s)).toHaveLength(1);
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "bust", escapees: ["p2"], winners: ["p2"] });
  });

  it("the bust lands in the cap round, with honesty below the line: a bust, not theft", () => {
    // p0, p1 raided in the Vault; p2 pockets 2 Office coins (honesty 0 of 2); p3 on the Rooftop.
    const s = round(game(4, [], { alarm: { bustStars: 1 }, roundCap: 1 }), [["vault", 3], ["vault", 3], ["office", 0, 2], ["rooftop", 0]]);
    expect(endings(s)).toHaveLength(1);
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "bust", escapees: ["p3"], winners: ["p3"] });
    // The ranking still shows every stash (§8.6): the pocket-heavy p2 is top of it but arrested.
    expect(outcome(s).ranking[0]).toMatchObject({ player: "p2", stash: 2 });
  });

  it("12 players, shipped numbers: three raids in one round jump Wanted 0 → 3 (a bust), both Rooftop players win tied", () => {
    // Vault: 2 × 3 rings = 6. Office: 4 × 1 ring (1st coin quiet). Deposit boxes: 4 × 1. Two on the Rooftop.
    const moves: [string, number, number?][] = [
      ["vault", 3], ["vault", 3],
      ["office", 2], ["office", 2], ["office", 2], ["office", 2],
      ["depositBoxes", 2], ["depositBoxes", 2], ["depositBoxes", 2], ["depositBoxes", 2],
      ["rooftop", 0], ["rooftop", 0],
    ];
    const s = round(game(12), moves);
    expect(s.wanted).toBe(3);
    expect(s.log.filter((e) => e.type === "roomRaided")).toHaveLength(3);
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "bust", escapees: ["p10", "p11"], winners: ["p10", "p11"] });
  });

  it("a bust with nobody on the Rooftop: nobody wins, the full ranking is kept", () => {
    const s = round(game(3, [], { alarm: { bustStars: 1 } }), [["vault", 3], ["vault", 3], ["lobby", 0, 1]]);
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "bust", escapees: [], winners: [] });
    expect(outcome(s).ranking).toHaveLength(3);
  });
});

describe("the honesty line at 12 players — design §7.5, §8.1, §8.4", () => {
  const once: ContentOverrides = { ...NO_RAIDS, roundCap: 1 };
  // 36 coins taken; the line is 24.
  it("exactly 24 of 36 reached the duffel: a success", () => {
    const s = vault(game(12, [], once), [3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(s.haul).toBe(24);
    expect(outcome(s)).toMatchObject({ result: "success", winners: ["p0", "p1", "p2", "p3"] });
  });

  it("one coin under (23 of 36): sunk by theft", () => {
    const s = vault(game(12, [], once), [3, 3, 3, 3, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect(s.haul).toBe(23);
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "theft", winners: [] });
  });

  it("3 players, the whole 48-coin bank: 32 of 48 (exactly 2/3, in floating point too) is a success, 31 is theft", () => {
    const play = (second: number[]) => {
      let s = game(3, [], NO_RAIDS);
      s = vault(s, [3, 3, 3]);
      s = vault(s, second);
      for (let r = 3; r <= 6; r++) {
        s = vault(s, [0, 0, 0]); // round 6 asks 9 of the last 3
        if (r === 3) s = meeting(s);
      }
      return s;
    };
    const at = play([3, 3, 1]); // 16 pocketed
    expect([at.bank, at.round, at.haul]).toEqual([0, 6, 32]);
    expect(outcome(at)).toMatchObject({ result: "success" });
    const under = play([3, 3, 2]); // 17 pocketed
    expect(under.haul).toBe(31);
    expect(outcome(under)).toMatchObject({ result: "failed", reason: "theft", winners: [] });
  });
});

describe("sunk by theft — design §8.4, §8.5", () => {
  const once: ContentOverrides = { ...NO_RAIDS, roundCap: 1 };
  // 12 players, 36 taken: 14 pocketed (22 of 36 < 24).
  const theft = [3, 3, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0];

  it("a Mole tied at the top with a player who can't win: only the Mole wins", () => {
    const s = vault(game(12, ["mole", "lookout"], once), theft);
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "theft", winners: ["p0"] });
  });

  it("two Mole copies tied at the top both win; the Lookout tied with them doesn't", () => {
    const s = vault(game(12, ["mole", "lookout", "mole"], once), [3, 3, 3, 2, 2, 0, 0, 0, 0, 0, 0, 0]); // 13 pocketed
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "theft", winners: ["p0", "p2"] });
  });

  it("a Mole one coin below the top wins nothing", () => {
    const s = vault(game(12, ["mole", "lookout"], once), [2, 3, 2, 2, 2, 2, 1, 0, 0, 0, 0, 0]);
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "theft", winners: [] });
  });

  it("no Mole in the game: nobody wins, the ranking still lists all 12", () => {
    const s = vault(game(12, [], once), theft);
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "theft", winners: [] });
    expect(outcome(s).ranking.map((e) => e.stash)).toEqual([3, 3, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0]);
  });

  it("a Mole at the top of a heist that succeeded wins like anyone (§8.1)", () => {
    const s = vault(game(3, ["mole"], once), [1, 0, 0]);
    expect(outcome(s)).toMatchObject({ result: "success", winners: ["p0"] });
  });
});

describe("§8.5 ties at the end — design §8.2, §8.5", () => {
  it("12 players, success, every stash equal (all 1): the whole crew wins", () => {
    const s = vault(game(12, ["mole"], { ...NO_RAIDS, roundCap: 1 }), all(12, 1)); // 24 of 36: exactly the line
    expect(outcome(s)).toMatchObject({ result: "success" });
    expect(outcome(s).winners).toEqual(Array.from({ length: 12 }, (_, i) => `p${i}`));
  });

  it("a success with eleven tied and one lower: the eleven win, in seat order", () => {
    const s = vault(game(12, [], { ...NO_RAIDS, roundCap: 1 }), all(12, 1).map((p, i) => (i === 5 ? 0 : p)));
    expect(outcome(s)).toMatchObject({ result: "success" });
    expect(outcome(s).winners).toEqual(Array.from({ length: 12 }, (_, i) => `p${i}`).filter((id) => id !== "p5"));
  });
});

describe("after the end — design §6.2, §17.2", () => {
  const ended = (): GameState => vault(game(3, [], { ...NO_RAIDS, roundCap: 1 }), [1, 0, 0]);
  it("every command is refused and leaves the state untouched", () => {
    const s = ended();
    const commands = [
      mv("p0", "vault", 3),
      { type: "advance", deadline: { kind: "round", round: 1 } },
      { type: "advance", deadline: { kind: "round", round: 2 } },
      { type: "advance", deadline: { kind: "alibis", round: 1 } },
      sched(1),
      { type: "advance", deadline: { kind: "openMeeting", meetingId: "m1" } },
      { type: "castVote", player: "p1", vote: { kind: "shakedown", target: "p0" } },
      { type: "callEmergency", player: "p1" },
    ];
    for (const c of commands) {
      const r = handleCommand(s, c);
      expect(r.ok, JSON.stringify(c)).toBe(false);
    }
    expect(endings(s)).toHaveLength(1);
  });
});

describe("determinism and replay — design §19.1", () => {
  const script = (seed: string): GameState => {
    let s = game(12, ["mole"], { bank: { coinsPerPlayer: 2 } }, seed); // 24 coins: a short bank in round 2
    s = round(s, Array.from({ length: 12 }, (_, i): [string, number, number] => ["lobby", i % 3 ? 1 : 0, i % 3 ? 0 : 1]));
    return round(s, Array.from({ length: 12 }, (_, i): [string, number, number] => (i % 2 ? ["office", 1, 1] : ["lobby", 0, 1])));
  };
  it("same seed + same commands = identical log, and the log replays to the same ended state", () => {
    const a = script("det");
    const b = script("det");
    expect(a.phase.kind).toBe("ended");
    expect(b.log).toEqual(a.log);
    expect(replay(a.config, JSON.parse(JSON.stringify(a.log)) as GameEvent[])).toEqual(a);
  });
});

describe("viewFor before and after the end — design §15.5, §18", () => {
  it("before the end: no other seat's stash, role or grab is visible; at the end the reveal shows them all", () => {
    let s = game(3, ["mole", "lookout"], { ...NO_RAIDS, roundCap: 2 });
    s = vault(s, [3, 0, 0]);
    expect(s.phase.kind).not.toBe("ended");
    const before = viewFor(s, "p1");
    expect(before.reveal).toBeNull();
    // Nothing private to p0 is in p1's view, and changing p0's hidden numbers leaves p1's view identical.
    const leaked = JSON.stringify(before.ledger) + JSON.stringify(before.caseFile);
    expect(leaked).not.toContain('"mole"');
    expect(viewFor(withPlayers(s, { p0: { stash: 99 } }), "p1")).toEqual(before);
    s = vault(s, [3, 0, 0]);
    const after = viewFor(s, "p1");
    expect(after.reveal).not.toBeNull();
    const o = after.reveal?.outcome as Outcome;
    expect(o.ranking.map((e) => [e.player, e.role, e.stash])).toEqual([["p0", "mole", 6], ["p1", "lookout", 0], ["p2", "rookie", 0]]);
    const revealed = after.reveal?.log.map((e) => e.event) ?? [];
    expect(revealed.some((e) => e.type === "coinsGrabbed" && e.player === "p0")).toBe(true);
    expect(revealed.some((e) => e.type === "roleDealt" && e.player === "p0")).toBe(true);
    // 6 of 18 pocketed: 12/18 = 2/3, a success won by the Mole's biggest stash.
    expect(o).toMatchObject({ result: "success", winners: ["p0"] });
  });
});
