// All-bot games, end to end: engine + bots + the minimal scheduler in run.ts.
// design §17.3 (bots play by the same rules, see only their view, behave as
// their personality says), §17.2 (determinism)
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameConfig, GameState, PlayerId, VoteVisibility } from "@skimjob/engine";
import { PERSONALITIES, type Personality, type PersonalityId } from "./personalities";
import { createBots, runBotGame, type BotGameResult } from "./run";
import type { Agent } from "./bot";

function config(n: number, seed: string, voteVisibility: VoteVisibility = "hiddenThenRevealed"): GameConfig {
  return {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    mole: "off",
    eventsEnabled: false,
    voteVisibility,
    starterMode: false,
  };
}

const MIXED: PersonalityId[] = ["honest", "opportunist", "cautious", "greedy", "random"];
const mix = (ids: readonly PersonalityId[]) => (_: unknown, i: number): Personality => PERSONALITIES[ids[i % ids.length] as PersonalityId];

function play(n: number, seed: string, ids: readonly PersonalityId[] = MIXED, mode?: VoteVisibility): BotGameResult {
  const c = config(n, seed, mode);
  return runBotGame(c, createBots(c.players, mix(ids), `bots-${seed}`));
}

const outcome = (s: GameState) => (s.phase.kind === "ended" ? s.phase.outcome : null);

afterEach(() => vi.restoreAllMocks());

describe("all-bot games — design §17.3", () => {
  const sizes = Array.from({ length: 11 }, (_, i) => i + 2);
  const mixes: [string, PersonalityId[]][] = [...Object.keys(PERSONALITIES).map((id) => [id, [id as PersonalityId]] as [string, PersonalityId[]]), ["mixed", MIXED]];

  it.each(mixes)("%s bots finish a game at every crew size from 2 to 12 with no refused command", (_name, ids) => {
    for (const n of sizes) {
      const { state, rejections, steps } = play(n, `size-${n}`, ids);
      expect(state.phase.kind, `${n} players`).toBe("ended");
      expect(rejections, `${n} players`).toEqual([]);
      expect(steps).toBeLessThan(40);
    }
  });

  it.each(["hiddenThenRevealed", "open", "secret"] as const)("in %s vote mode too", (mode) => {
    for (const n of [3, 6, 10]) {
      const { state, rejections } = play(n, `mode-${n}`, MIXED, mode);
      expect(state.phase.kind).toBe("ended");
      expect(rejections).toEqual([]);
    }
  });

  it("is deterministic: same game seed and bot seed, same log; another bot seed, another game — design §17.2", () => {
    expect(JSON.stringify(play(6, "det").state.log)).toBe(JSON.stringify(play(6, "det").state.log));
    const c = config(6, "det");
    const other = runBotGame(c, createBots(c.players, mix(MIXED), "other-bots"));
    expect(JSON.stringify(other.state.log)).not.toBe(JSON.stringify(play(6, "det").state.log));
  });

  it("uses no Math.random or Date.now", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random used");
    });
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Date.now used");
    });
    expect(play(5, "no-clock").state.phase.kind).toBe("ended");
  });

  it("each bot gets only its own view, and never writes to it", () => {
    const deepFreeze = (v: unknown): void => {
      if (typeof v !== "object" || v === null || Object.isFrozen(v)) return;
      Object.freeze(v);
      for (const x of Object.values(v)) deepFreeze(x);
    };
    const c = config(5, "frozen");
    const agents: Agent[] = createBots(c.players, mix(MIXED), "frozen").map((bot) => ({
      player: bot.player,
      act: (view) => {
        expect(view.me.id).toBe(bot.player);
        deepFreeze(view); // a bot that wrote to its view would throw here (ESM is strict)
        return bot.act(view);
      },
    }));
    const { state, rejections } = runBotGame(c, agents);
    expect(state.phase.kind).toBe("ended");
    expect(rejections).toEqual([]);
  });

  it("seats without an agent play default moves, like an absent player — design §5.1", () => {
    const c = config(4, "absent");
    const { state, rejections } = runBotGame(c, createBots(c.players.slice(0, 2), mix(["honest"]), "absent"));
    expect(state.phase.kind).toBe("ended");
    expect(rejections).toEqual([]);
    expect(state.log.filter((e) => e.type === "defaultMoveAssigned" && e.player === "p3").length).toBeGreaterThan(0);
  });

  it("with the events deck on (and Moles), bots finish at every size with no refused command — design §10", () => {
    const seen = new Set<string>();
    let swaps = 0;
    let answers = 0;
    let lockdowns = 0;
    for (const n of sizes) {
      for (const seed of ["ev-a", "ev-b", "ev-c"]) {
        const c: GameConfig = { ...config(n, `${seed}-${n}`), eventsEnabled: true, mole: n >= 5 ? "on" : "off" };
        const { state, rejections } = runBotGame(c, createBots(c.players, mix(MIXED), `bots-${seed}`));
        expect(state.phase.kind, `${n} players`).toBe("ended");
        expect(rejections, `${n} players`).toEqual([]);
        for (const e of state.log) {
          if (e.type === "eventFlipped") seen.add(e.card);
          if (e.type === "eventFlipped" && e.card === "lockdown") lockdowns++;
          if (e.type === "doubleCrossAnswered") answers++;
          if (e.type === "doubleCrossResolved" && e.swap) swaps++;
        }
      }
    }
    expect(seen.size).toBe(10);
    expect(lockdowns).toBeGreaterThan(0);
    expect(answers).toBeGreaterThan(0);
    expect(swaps).toBeGreaterThan(0);
   }, 30_000); // many full games: over the 5 s default on a busy machine

  it("bots never propose a slot, so the server picks every act's meeting — design §11.1 (STATUS bot scheduling)", () => {
    const { state } = play(5, "schedule", ["honest"]);
    const scheduled = state.log.filter((e) => e.type === "meetingScheduled");
    expect(scheduled.length).toBe(3);
    expect(state.log.some((e) => e.type === "meetingProposed")).toBe(false);
    expect(scheduled.every((e) => e.type === "meetingScheduled" && e.proposalId === null)).toBe(true);
  });
});

/** Totals over a batch of games, read from the full logs. */
function stats(ids: readonly PersonalityId[], n: number, games: number) {
  let success = 0;
  let shakedowns = 0;
  let dirty = 0;
  const by = new Map<string, { rounds: number; pocketed: number; pocketRounds: number; lies: number; laidLow: number; watched: number }>();
  for (let g = 0; g < games; g++) {
    const { state } = play(n, `stats-${g}`, ids);
    if (outcome(state)?.result === "success") success++;
    const personality = (id: PlayerId) => (PERSONALITIES[ids[state.playerOrder.indexOf(id) % ids.length] as PersonalityId]).name;
    const real = new Map<string, string>();
    for (const e of state.log) {
      if (e.type === "lootSplit") {
        const s = by.get(personality(e.player)) ?? { rounds: 0, pocketed: 0, pocketRounds: 0, lies: 0, laidLow: 0, watched: 0 };
        by.set(personality(e.player), s);
        real.set(`${e.player}/${e.round}`, e.room);
        s.rounds++;
        s.pocketed += e.toStash;
        if (e.toStash > 0) s.pocketRounds++;
        if (e.room === "rooftop") s.laidLow++;
        if (e.room === "security") s.watched++;
      }
      if (e.type === "alibiPosted" && real.get(`${e.player}/${e.round}`) !== e.room) {
        const s = by.get(personality(e.player));
        if (s) s.lies++;
      }
      if (e.type === "shakedownResolved") {
        shakedowns++;
        if (!e.clean) dirty++;
      }
    }
  }
  return { success: success / games, shakedowns, dirty, by };
}

describe("personalities behave as design §17.3 describes", () => {
  const all = stats(["honest", "opportunist", "greedy", "cautious"], 8, 30);
  const of = (name: string) => {
    const s = all.by.get(name);
    if (!s) throw new Error(`no ${name}`);
    return s;
  };

  it("Greed: Greedy pockets more than the Opportunist, who pockets more than Honest and Cautious", () => {
    const perRound = (name: string) => of(name).pocketed / of(name).rounds;
    expect(perRound("Greedy")).toBeGreaterThan(perRound("Opportunist"));
    expect(perRound("Opportunist")).toBeGreaterThan(perRound("Honest"));
    expect(perRound("Opportunist")).toBeGreaterThan(perRound("Cautious"));
  });

  it("Lies: Honest never lies; Greedy lies more often than the Opportunist, who lies only when unseen", () => {
    expect(of("Honest").lies).toBe(0);
    expect(of("Greedy").lies / of("Greedy").rounds).toBeGreaterThan(of("Opportunist").lies / of("Opportunist").rounds);
    expect(of("Opportunist").lies).toBeGreaterThan(0);
  });

  it("Cautious spends more turns on the Rooftop and in Security than Honest", () => {
    const careful = (name: string) => (of(name).laidLow + of(name).watched) / of(name).rounds;
    expect(careful("Cautious")).toBeGreaterThan(careful("Honest"));
  });

  it("sanity: honest crews usually pull the job off, and most shakedowns in a mixed crew catch someone with loot", () => {
    // Loose bounds so the balance pass (task 11) can retune numbers without breaking this; the simulator reports the real figures.
    expect(stats(["honest"], 5, 20).success).toBeGreaterThanOrEqual(0.8);
    expect(all.shakedowns).toBeGreaterThan(0);
    expect(all.dirty / all.shakedowns).toBeGreaterThan(0.5);
  });
});

describe("role powers in bot games — design §8", () => {
  // 5 players: the Inside Man is dealt only from 5 (design §8.1).
  const states = Array.from({ length: 10 }, (_, g) => play(5, `roles-${g}`, ["opportunist", "greedy"]).state);
  const roleOf = (s: GameState, id: PlayerId) => s.players[id]?.role;

  it("the Inside Man never pockets", () => {
    const splits = states.flatMap((s) => s.log.filter((e) => e.type === "lootSplit" && roleOf(s, e.player) === "insideMan"));
    expect(splits.length).toBeGreaterThan(0);
    expect(splits.every((e) => e.type === "lootSplit" && e.toStash === 0)).toBe(true);
  });

  it("the Lookout watches an extra room", () => {
    const used = states.flatMap((s) => s.log).filter((e) => e.type === "abilityResolved" && e.ability.kind === "lookout");
    expect(used.length).toBeGreaterThan(0);
  });
});

describe("bots with the accomplices dealt — role deck v2 §2, §4 (R3a)", () => {
  // 9 players with a Mole: one or two accomplices from these three, every game.
  const games = Array.from({ length: 12 }, (_, g) => {
    const c = { ...config(9, `dark-${g}`), mole: "on" as const, rolePool: ["getawayDriver", "fence", "hacker", "lookout", "rookie", "bagman", "auditor"] };
    return runBotGame(c, createBots(c.players, mix(MIXED), `bots-${c.seed}`));
  });
  const log = games.flatMap((g) => g.state.log);

  it("finish with no refused command; the Fence fills its safe, the Hacker loops, the Mole tips off", () => {
    for (const g of games) expect([g.state.phase.kind, g.rejections]).toEqual(["ended", []]);
    const used = (kind: string) => log.filter((e) => e.type === "abilityResolved" && e.ability.kind === kind);
    for (const k of ["fenceSafe", "loopCameras", "tipOff"]) expect(used(k).length, k).toBeGreaterThan(0);
    expect(log.some((e) => e.type === "alliesLearned")).toBe(true);
  });

  it("the Getaway Driver goes to the Rooftop, and no dark-side bot votes to shake down an ally it knows", () => {
    let rooftop = 0;
    for (const g of games) {
      const s = g.state;
      const driver = s.playerOrder.find((id) => s.players[id]?.role === "getawayDriver");
      rooftop += s.log.filter((e) => e.type === "lootSplit" && e.player === driver && e.room === "rooftop").length;
      const allies = new Map<string, string[]>();
      for (const e of s.log) {
        if (e.type === "moleAllies") allies.set(e.player, [...e.allies]);
        if (e.type === "alliesLearned") allies.set(e.player, [...(allies.get(e.player) ?? []), ...e.allies]);
        if (e.type === "voteCast" && e.vote.kind === "shakedown") expect(allies.get(e.player) ?? []).not.toContain(e.vote.target);
      }
    }
    expect(rooftop).toBeGreaterThan(0);
  });
});

describe("bots with the Blackmailer, Forger and Embezzler dealt — role deck v2 §2, §4 (R3b)", () => {
  // 9 players with a saboteur (Mole or Embezzler, or both) and accomplices from these two.
  const games = Array.from({ length: 12 }, (_, g) => {
    const c = { ...config(9, `dark3b-${g}`), mole: "on" as const, rolePool: ["blackmailer", "forger", "lookout", "rookie", "bagman", "auditor", "detective"] };
    return runBotGame(c, createBots(c.players, mix(MIXED), `bots-${c.seed}`));
  });
  const log = games.flatMap((g) => g.state.log);

  it("finish with no refused command; the Forger plants sightings and the Embezzler takes", () => {
    for (const g of games) expect([g.state.phase.kind, g.rejections]).toEqual(["ended", []]);
    const used = (kind: string) => log.filter((e) => e.type === "abilityResolved" && e.ability.kind === kind);
    for (const k of ["forge", "embezzle"]) expect(used(k).length, k).toBeGreaterThan(0);
    expect(log.some((e) => e.type === "sightingForged")).toBe(true);
  });
});

describe("bots with the info and vote roles dealt — design §8, §17.3 (task 12)", () => {
  // The Hacker is an accomplice since R3a (tested below with the dark side).
  // The Blackmailer is an accomplice since R3b (tested below with the dark side).
  const ROLE_POOL = ["smoothTalker", "muscle", "snitch"];

  it("finish every game with no refused command, and use the Muscle power", () => {
    const used = new Set<string>();
    const types = new Set<string>();
    for (const mode of ["hiddenThenRevealed", "open", "secret"] as const) {
      for (let i = 0; i < 20; i++) {
        for (const n of [3, 5, 6]) {
          const c = { ...config(n, `info-${mode}-${n}-${i}`, mode), rolePool: ROLE_POOL };
          const r = runBotGame(c, createBots(c.players, mix(MIXED), `bots-${c.seed}`));
          expect(r.state.phase.kind).toBe("ended");
          expect(r.rejections).toEqual([]);
          for (const e of r.state.log) {
            types.add(e.type);
            if (e.type === "abilityResolved") used.add(e.ability.kind);
          }
        }
      }
    }
    for (const k of ["cancelShakedown"]) expect(used, k).toContain(k);
    for (const t of ["snitchTargetAssigned", "shakedownPending", "shakedownCancelled"]) expect(types, t).toContain(t);
   }, 30_000); // 180 games: over the 5 s default on a busy machine
});

describe("bots with Moles and the Driver dealt — design §8, §8.1, §17.3 (task 13)", () => {
  const games = [5, 9, 12].flatMap((n) =>
    Array.from({ length: 15 }, (_, i) => {
      const c: GameConfig = { ...config(n, `moles-${n}-${i}`), mole: "on" };
      return runBotGame(c, createBots(c.players, mix(MIXED), `bots-${c.seed}`));
    }),
  );

  it("finish with no refused command; each Mole tips off at most once per act", () => {
    let tips = 0;
    for (const r of games) {
      expect(r.state.phase.kind).toBe("ended");
      expect(r.rejections).toEqual([]);
      const resolved = r.state.log.filter((e) => e.type === "roundResolved").length;
      for (const id of r.state.playerOrder) {
        if (r.state.players[id]?.role !== "mole") continue;
        const acts = r.state.log.flatMap((e) => (e.type === "abilityResolved" && e.player === id && e.ability.kind === "tipOff" ? [Math.ceil(e.round / 3)] : []));
        tips += acts.length;
        expect(new Set(acts).size).toBe(acts.length);
        expect(acts.every((a) => a * 3 - 2 <= resolved)).toBe(true);
      }
    }
    expect(tips).toBeGreaterThan(0);
  });

  it("Moles win some failed heists and no successful one", () => {
    let moleWins = 0;
    for (const r of games) {
      const o = outcome(r.state);
      const moleWinners = (o?.winners ?? []).filter((id) => r.state.players[id]?.role === "mole");
      if (o?.result === "success") expect(moleWinners).toEqual([]);
      moleWins += moleWinners.length;
    }
    expect(moleWins).toBeGreaterThan(0);
  });
});

describe("Duel games — design §16.1", () => {
  it("bots finish Duel games (events on and off) with no refused command, calling out but never meeting", () => {
    const verdicts = new Set<boolean>();
    for (let g = 0; g < 30; g++) {
      const c: GameConfig = { ...config(2, `duel-${g}`), duel: true, eventsEnabled: g % 2 === 0 };
      const { state, rejections } = runBotGame(c, createBots(c.players, mix(MIXED.slice(g % 4)), `bots-duel-${g}`));
      expect(state.phase.kind).toBe("ended");
      expect(rejections).toEqual([]);
      const types = new Set(state.log.map((e) => e.type));
      for (const t of ["meetingProposed", "meetingOpened", "voteCast", "emergencyMeetingCalled"]) expect(types.has(t as never), t).toBe(false);
      for (const e of state.log) if (e.type === "callOutResolved") verdicts.add(e.caught);
    }
    // Caught and wrong call-outs both happen.
    expect([...verdicts].sort()).toEqual([false, true]);
  });
});
