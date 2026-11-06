// QA for PR #43: the crew's shared hunch is seeded by a hidden crewSeed, so it
// can't be worked out from public data. Two games whose views are identical
// (same seats, same public and private events) but whose secret seeds differ
// give different hunches, and createBots derives the crewSeed from the hidden
// game seed only. design §17.3 (bots are players), roles-v2 §5; PR #37 review
import { createGame, handleCommand, viewFor, type Command, type GameConfig, type GameState, type PlayerView } from "@skimjob/engine";
import { describe, expect, it, vi } from "vitest";
import type { BotOptions } from "./bot";

const captured = vi.hoisted(() => [] as BotOptions[]);
vi.mock("./bot", async (importOriginal) => {
  const real = await importOriginal<typeof import("./bot")>();
  return {
    ...real,
    createBot: (o: BotOptions) => {
      captured.push(o);
      return real.createBot(o);
    },
  };
});

const { botRandom, chooseVote, crewHunch } = await import("./bot");
const { PERSONALITIES } = await import("./personalities");
const { createBots, runBotGame } = await import("./run");

/** All Rookies, Mole off, events off: nothing in any view but the public shop depends on the seed. */
const config = (seed: string, n = 6): GameConfig => ({
  seed,
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Bot ${i + 1}`, isBot: true })),
  job: "bank",
  rolePool: ["rookie"],
  uniqueRoles: false,
  mole: "off",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
});

const must = (state: GameState, c: Command): GameState => {
  const r = handleCommand(state, c);
  if (!r.ok) throw new Error(`${JSON.stringify(c)}: ${r.reason}`);
  return r.state;
};

/** The same scripted commands (p1 pockets 2 a round, everyone else all-in in room 1) up to act 1's meeting. */
function atFirstMeeting(seed: string): GameState {
  let s = createGame(config(seed));
  for (let guard = 0; guard < 50; guard++) {
    const phase = s.phase;
    if (phase.kind === "meeting") return s;
    if (phase.kind === "planning") {
      for (const p of s.playerOrder) {
        const room = viewFor(s, p).rooms[0]!;
        s = must(s, { type: "submitMove", player: p, move: { room, pocket: p === "p1" ? 2 : 0 } });
      }
      s = must(s, { type: "advance", deadline: { kind: "round", round: phase.round } });
    } else if (phase.kind === "alibis") {
      s = must(s, { type: "advance", deadline: { kind: "alibis", round: phase.round } });
    } else if (phase.kind === "awaitingMeeting") {
      if (!s.scheduledMeeting) s = must(s, { type: "scheduleMeeting", act: phase.act, slot: `server-act-${phase.act}` });
      s = must(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting!.meetingId } });
    } else throw new Error(`unexpected phase ${phase.kind}`);
  }
  throw new Error("no meeting");
}

const SEEDS = Array.from({ length: 12 }, (_, i) => `hidden-${i}`);

describe("QA PR #43: crewSeed — the hunch is not computable from public data", () => {
  const games = SEEDS.map((seed) => ({ seed, state: atFirstMeeting(seed) }));
  const views = (p: string): PlayerView[] => games.map((g) => viewFor(g.state, p));

  it("the games are indistinguishable to every player: identical views (public and private) despite different secret seeds", () => {
    for (const p of games[0]!.state.playerOrder) {
      // The perk shop is dealt from the game seed, in the open (extension.md "Tokens and the perk shop"): not the crew seed.
      const all = views(p).map((v) => JSON.stringify(v, (k, x: unknown) => (k === "shop" || (x as { type?: string } | null)?.type === "shopDealt" ? undefined : x)));
      expect(new Set(all).size, p).toBe(1);
      // And the secret seed is nowhere in a view.
      for (const [i, text] of all.entries()) expect(text).not.toContain(SEEDS[i]);
    }
  });

  it("the hunch depends on the crewSeed, not on view data: identical views give the same hunch for one crewSeed and different hunches for different ones", () => {
    for (const p of ["p1", "p2", "p3"]) {
      const same = views("p2").map((v) => crewHunch(v, p, "fixed/crew"));
      expect(new Set(same).size, p).toBe(1);
      const differ = views("p2").map((v, i) => crewHunch(v, p, `${SEEDS[i]}/crew`));
      expect(new Set(differ).size, p).toBe(differ.length);
    }
  });

  it("with the crewSeed createBots derives from each hidden seed, the same views give different hunches", () => {
    captured.length = 0;
    const crewSeeds = games.map((g) => {
      const before = captured.length;
      createBots(g.state.config.players, () => PERSONALITIES.honest, g.seed);
      const made = captured.slice(before);
      expect(made).toHaveLength(6);
      // One crewSeed for the whole table, from the hidden seed; not the bot's own seed.
      expect(new Set(made.map((o) => o.crewSeed)).size).toBe(1);
      for (const o of made) expect(o.crewSeed).not.toBe(o.seed);
      return made[0]!.crewSeed!;
    });
    expect(crewSeeds).toEqual(SEEDS.map((s) => `${s}/crew`));
    for (const p of ["p1", "p2", "p3", "p4"]) {
      const hunches = views("p2").map((v, i) => crewHunch(v, p, crewSeeds[i]!));
      expect(new Set(hunches).size, p).toBe(hunches.length);
      // Still shared: every bot at a table reads the same hunch for p.
      for (const [i, g] of games.entries()) expect(crewHunch(viewFor(g.state, "p5"), p, crewSeeds[i]!)).toBe(hunches[i]);
    }
  });

  it("it changes votes: same view, same bot random, different crewSeed → some vote differs; same crewSeed → identical votes", () => {
    const view = viewFor(games[0]!.state, "p3");
    const p = PERSONALITIES.honest;
    const votes = SEEDS.map((s) => JSON.stringify(chooseVote(view, p, botRandom("same"), `${s}/crew`)));
    expect(new Set(votes).size).toBeGreaterThan(1);
    const plain = games.map((g) => JSON.stringify(chooseVote(viewFor(g.state, "p3"), p, botRandom("same"), "fixed/crew")));
    expect(new Set(plain).size).toBe(1);
  });

  it("an all-bot game with createBots is deterministic (same seed → identical log) and refuses nothing", () => {
    const run = (seed: string) => runBotGame(config(seed), createBots(config(seed).players, () => PERSONALITIES.opportunist, seed));
    const a = run("hidden-0");
    expect(JSON.stringify(run("hidden-0").state.log)).toBe(JSON.stringify(a.state.log));
    expect(a.rejections).toEqual([]);
  });
});
