// Bot decisions from a view: moves, alibis, meeting scheduling, votes, role
// powers, and determinism. design §17.3 (and §5.1, §5.4, §8, §11.1, §11.2)
import { describe, expect, it } from "vitest";
import { roomDef, viewFor, jobById, type GameEvent, type GameState, type Move, type PlayerCommand } from "@skimjob/engine";
import { PERSONALITIES, type Personality } from "./personalities";
import { botRandom, chooseAlibi, chooseMove, chooseVote, createBot, crewHunch, decide, misjudged, type Random } from "./bot";
import { suspicion } from "./suspicion";
import { closeAlibis, game, round, run } from "./testkit";

/** A personality with no noise or misreading at votes, so a test can pin its behaviour. */
const exact = (base: Personality, change: Partial<Personality> = {}): Personality => ({ ...base, noise: 0, misread: 0, hunch: 0, ...change });
/** Random numbers from a list (then 0.5 forever). */
const rolls = (...values: number[]): Random => () => values.shift() ?? 0.5;
const seeded = botRandom;

const bank = jobById("bank");
const submitted = (cmds: PlayerCommand[]): Move | undefined => {
  const c = cmds.find((x) => x.type === "submitMove");
  return c?.type === "submitMove" ? c.move : undefined;
};

describe("Agent — design §17.3", () => {
  it("same seed and same view give the same commands, every time", () => {
    const s = game(5);
    for (const personality of Object.values(PERSONALITIES)) {
      const a = createBot({ player: "ana", personality, seed: "x", crewSeed: "test-crew" });
      const b = createBot({ player: "ana", personality, seed: "x", crewSeed: "test-crew" });
      for (let i = 0; i < 5; i++) expect(a.act(viewFor(s, "ana"))).toEqual(b.act(viewFor(s, "ana")));
    }
  });

  it("refuses another player's view", () => {
    const bot = createBot({ player: "ana", personality: PERSONALITIES.honest, seed: "x", crewSeed: "test-crew" });
    expect(() => bot.act(viewFor(game(3), "ben"))).toThrow();
  });

  it("in round 1 planning: submits a valid move and leaves the meeting time to people; no alibi yet — design §5.1, §11.1", () => {
    const s = game(4);
    const cmds = decide(viewFor(s, "ana"), PERSONALITIES.honest, seeded("a"), "test-crew");
    expect(cmds.map((c) => c.type)).toEqual(["submitMove"]);
    expect(run(s, ...cmds).moves.ana).toBeDefined();
  });

  it("never proposes a meeting slot, even late in the act; only backs existing ones (STATUS bot scheduling, #35 review) — design §11.1", () => {
    const lobby = { room: "lobby" };
    const all = (s: GameState) => Object.fromEntries(s.playerOrder.map((id) => [id, lobby]));
    let s = game(4);
    const proposes = (st: GameState) => decide(viewFor(st, "ana"), exact(PERSONALITIES.honest), seeded("a"), "test-crew").some((c) => c.type === "proposeMeeting");
    expect(proposes(s)).toBe(false);
    s = closeAlibis(round(s, all(s)));
    expect(proposes(s)).toBe(false);
    s = closeAlibis(round(s, all(s))); // round 3: the act's last round
    expect(proposes(s)).toBe(false);
  });

  it("backs a person's proposal before a bot's — design §11.1", () => {
    const people = (st: GameState): GameState => ({ ...st, config: { ...st.config, players: st.config.players.map((x) => (x.id === "dee" || x.id === "carl" ? { ...x, isBot: false } : x)) } });
    let s = run(people(game(5)), { type: "proposeMeeting", player: "ben", slot: "act-1" }, { type: "proposeMeeting", player: "dee", slot: "2026-11-02T19:00Z" });
    const view = viewFor(s, "ana");
    (view.players as unknown as { id: string; isBot: boolean }[]).forEach((o) => (o.isBot = o.id !== "dee"));
    expect(decide(view, PERSONALITIES.honest, seeded("a"), "test-crew")[0]).toEqual({ type: "acceptMeeting", player: "ana", proposalId: "proposal-2" });
    s = run(s, { type: "acceptMeeting", player: "ana", proposalId: "proposal-2" });
    expect(s.proposals.find((p) => p.id === "proposal-2")?.acceptedBy).toEqual(["dee", "ana"]);
  });

  it("accepts an open proposal instead of proposing another, and does nothing once the slot is locked — design §11.1", () => {
    let s = run(game(4), { type: "proposeMeeting", player: "ben", slot: "act-1" });
    expect(decide(viewFor(s, "ana"), PERSONALITIES.honest, seeded("a"), "test-crew")[0]).toEqual({ type: "acceptMeeting", player: "ana", proposalId: "proposal-1" });
    s = run(s, { type: "acceptMeeting", player: "carl", proposalId: "proposal-1" }, { type: "acceptMeeting", player: "dee", proposalId: "proposal-1" });
    expect(decide(viewFor(s, "ana"), PERSONALITIES.honest, seeded("a"), "test-crew").map((c) => c.type)).toEqual(["submitMove"]);
  });

  it("does nothing more once its move is in and the meeting proposed", () => {
    const s = run(game(3), { type: "submitMove", player: "ana", move: { room: "lobby", pocket: 0 } }, { type: "proposeMeeting", player: "ana", slot: "s" });
    expect(decide(viewFor(s, "ana"), PERSONALITIES.greedy, seeded("a"), "test-crew")).toEqual([]);
  });
});

describe("moves — design §5.1, §6, §7, §8", () => {
  it("every personality's moves are accepted by the engine, at every crew size", () => {
    for (const n of [3, 5, 9, 12]) {
      const s = game(n);
      for (const personality of Object.values(PERSONALITIES)) {
        for (const id of s.playerOrder) {
          const random = seeded(`${n}-${personality.name}-${id}`);
          for (let i = 0; i < 10; i++) run(s, { type: "submitMove", player: id, move: chooseMove(viewFor(s, id), personality, random) });
        }
      }
    }
  });

  it("Security always names a room to watch — design §6.1", () => {
    const s = game(4);
    const move = chooseMove(viewFor(s, "ana"), exact(PERSONALITIES.cautious, { watch: 1 }), seeded("w"));
    expect(move.room).toBe("security");
    expect(move.watch && roomDef(bank, move.watch).loot).toBeGreaterThan(0);
  });

  it("heads for the Rooftop when Heat is close to a raid — design §7", () => {
    const s = { ...game(4), heat: 90 } satisfies GameState;
    const rooms = Array.from({ length: 20 }, (_, i) => chooseMove(viewFor(s, "ana"), exact(PERSONALITIES.honest), seeded(`h${i}`)).room);
    expect(rooms.filter((r) => r === "rooftop").length).toBeGreaterThan(10);
  });

  it("keeps the Haul on pace for the checkpoint when it's behind — design §11.5", () => {
    // Round 3, Haul 0, target 6 × 4 = 24: each needs to hand in 6 this round, so nothing is pocketed.
    let s = game(4);
    for (let r = 1; r <= 2; r++) s = round(s, { ana: { room: "rooftop" }, ben: { room: "rooftop" }, carl: { room: "rooftop" }, dee: { room: "rooftop" } });
    s = closeAlibis(s); // round 3 is being planned
    const greedyTeamPlayer = exact(PERSONALITIES.greedy, { pocketChance: 1, teamSpirit: 1, watch: 0, heatCaution: 2 });
    for (let i = 0; i < 20; i++) expect(chooseMove(viewFor(s, "ana"), greedyTeamPlayer, seeded(`p${i}`)).pocket).toBe(0);
  });
});

describe("alibis — design §5.4", () => {
  // Ana pockets 4 of the Vault's 6, handing in 2; whether anyone saw her decides the cover-up.
  const pocketed = (withWitness: boolean): GameState =>
    round(game(3), {
      ana: { room: "vault", pocket: 4, alibi: null },
      ben: { room: withWitness ? "vault" : "office" },
      carl: { room: "lobby" },
    });

  it("Honest always tells the truth", () => {
    expect(chooseAlibi(viewFor(pocketed(false), "ana"), PERSONALITIES.honest, rolls(0))).toBe("vault");
  });

  it("covers a skim with the richest room it really handed in (Lobby for 2), when it lies — design §5.3", () => {
    expect(chooseAlibi(viewFor(pocketed(false), "ana"), exact(PERSONALITIES.opportunist, { lie: 1 }), rolls(0))).toBe("lobby");
  });

  it("the Opportunist lies only when nobody saw it; the Greedy bot lies anyway", () => {
    const opportunist = exact(PERSONALITIES.opportunist, { lie: 1 });
    const greedy = exact(PERSONALITIES.greedy, { lie: 1 });
    expect(chooseAlibi(viewFor(pocketed(true), "ana"), opportunist, rolls(0))).toBe("vault");
    expect(chooseAlibi(viewFor(pocketed(true), "ana"), greedy, rolls(0))).toBe("lobby");
  });

  it("tells the truth when it handed everything in, and posts only once per round", () => {
    const s = round(game(3), { ana: { room: "vault", alibi: null }, ben: { room: "office" }, carl: { room: "lobby" } });
    expect(chooseAlibi(viewFor(s, "ana"), exact(PERSONALITIES.greedy, { lie: 1 }), rolls(0))).toBe("vault");
    expect(chooseAlibi(viewFor(s, "ben"), PERSONALITIES.honest, rolls(0))).toBeNull(); // the script posted it
  });
});

describe("votes — design §11.2, §17.3", () => {
  // Ben pockets in the Vault in front of Ana and claims the Lobby, twice: two caught lies.
  function liar(): GameState {
    let s = game(3);
    for (let r = 1; r <= 2; r++) s = round(s, { ana: { room: "vault" }, ben: { room: "vault", pocket: 3, alibi: "lobby" }, carl: { room: "office" } });
    return s;
  }

  it("shakes down the most suspicious player once their score passes the bot's threshold", () => {
    expect(chooseVote(viewFor(liar(), "ana"), exact(PERSONALITIES.honest), rolls(0.5), "test-crew")).toEqual({ kind: "shakedown", target: "ben" });
  });

  it("skips below the threshold (the Greedy bot is slow to suspect; Carl saw nothing)", () => {
    expect(chooseVote(viewFor(liar(), "ana"), exact(PERSONALITIES.greedy, { voteAt: 100 }), rolls(0.5), "test-crew")).toEqual({ kind: "skip" });
    expect(chooseVote(viewFor(liar(), "carl"), exact(PERSONALITIES.honest), rolls(0.5), "test-crew")).toEqual({ kind: "skip" });
  });

  it("votes in an open meeting, once", () => {
    let s = run(liar(), { type: "callEmergency", player: "carl" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-carl" } });
    const cmds = decide(viewFor(s, "ana"), exact(PERSONALITIES.honest), rolls(0.5), "test-crew");
    expect(cmds[0]).toEqual({ type: "castVote", player: "ana", vote: { kind: "shakedown", target: "ben" } });
    s = run(s, ...cmds);
    expect(decide(viewFor(s, "ana"), exact(PERSONALITIES.honest), rolls(0.5), "test-crew").filter((c) => c.type === "castVote")).toEqual([]);
  });

  it("misjudges at votes: a crew-wide hunch (the same for every bot at a meeting) plus its own misreading (v2 §5)", () => {
    const s = run(liar(), { type: "callEmergency", player: "carl" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-carl" } });
    const [a, c] = [viewFor(s, "ana"), viewFor(s, "carl")];
    expect(crewHunch(a, "ben", "test-crew")).toBe(crewHunch(c, "ben", "test-crew"));
    expect(Math.abs(crewHunch(a, "ben", "test-crew"))).toBeLessThanOrEqual(1);
    // Another meeting, another hunch.
    expect(crewHunch({ ...a, phase: { kind: "meeting", meetingId: "act-1" } }, "ben", "test-crew")).not.toBe(crewHunch(a, "ben", "test-crew"));
    const evidence = suspicion(a);
    const p = exact(PERSONALITIES.honest, { hunch: 7, misread: 1 });
    const read = misjudged(a, evidence, p, rolls(0.5), "test-crew"); // own misreading 0 at a roll of 0.5
    for (const [id, score] of evidence) expect(read.get(id)).toBeCloseTo(score + 7 * crewHunch(a, id, "test-crew"));
    // With no hunch or misreading, a bot reads the evidence as it is.
    expect(misjudged(a, evidence, exact(PERSONALITIES.honest), rolls(0.9), "test-crew")).toEqual(evidence);
  });

  it("calls its emergency meeting when suspicion is high enough — design §11.1", () => {
    const cmds = decide(viewFor(closeAlibis(liar()), "ana"), exact(PERSONALITIES.cautious, { emergencyAt: 8 }), rolls(0.5), "test-crew");
    expect(cmds.map((c) => c.type)).toContain("callEmergency");
  });
});

// ---------------------------------------------------------------- role habits (balance pass 2, task 16)

describe("role habits — design §8", () => {
  /** A 5-player game where `player` holds `role` (roles are swapped in by hand; the engine isn't asked). */
  const withRole = (s: GameState, player: string, role: string, roleState: Partial<GameState["players"][string]["roleState"]> = {}): GameState => {
    const me = s.players[player] as GameState["players"][string];
    return { ...s, players: { ...s.players, [player]: { ...me, role, roleState: { ...me.roleState, ...roleState } } } };
  };

  it("Auditor audits the room its top suspect claimed; Detective checks its top suspect in the act's last round (v2 §2, §4)", () => {
    const lobby = { room: "lobby" };
    // Round 1: ben pockets 4 in the Vault and claims the Office: the top suspect.
    const dealt = game(5);
    let s = closeAlibis(round(dealt, { ana: lobby, ben: { room: "vault", pocket: 4, alibi: "office" }, carl: lobby, dee: lobby, eve: lobby }));
    const uses = (st: GameState, role: string, used = 0) =>
      decide(viewFor(withRole(st, "ana", role, { usedThisAct: used }), "ana"), exact(PERSONALITIES.honest), seeded("c"), "test-crew").filter((c) => c.type === "useAbility");
    expect(uses(s, "auditor")).toEqual([{ type: "useAbility", player: "ana", ability: { kind: "audit", room: "office" } }]);
    expect(uses(s, "auditor", 1)).toEqual([]);
    expect(uses(s, "detective")).toEqual([]); // round 2 isn't the act's last
    s = closeAlibis(round(s, { ana: lobby, ben: lobby, carl: lobby, dee: lobby, eve: lobby }));
    expect(uses(s, "detective")).toEqual([{ type: "useAbility", player: "ana", ability: { kind: "checkStash", target: "ben" } }]);
    expect(uses(s, "detective", 1)).toEqual([]);
  });
});
