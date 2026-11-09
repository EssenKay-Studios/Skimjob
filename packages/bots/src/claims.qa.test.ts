// QA (PR #37): bot role claims, bluffs and meeting-proposal timing in whole games.
// design §9.4, §11.3, §15.4, §19.3; docs/roles-v2.md §4
import { ROLES } from "@skimjob/content";
import { replay, viewFor, type GameConfig, type GameEvent, type PlayerCommand, type PlayerView, type Statement, type VoteVisibility } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import type { Agent } from "./bot";
import { PERSONALITIES, type PersonalityId } from "./personalities";
import { createBots, runBotGame } from "./run";
import { bluffs, publicSuspicion, SAFE_BLUFFS } from "./claims";
import { suspicion } from "./suspicion";
import { game, run } from "./testkit";

const MIX: PersonalityId[] = ["honest", "opportunist", "greedy", "cautious"];
const MODES: readonly VoteVisibility[] = ["hiddenThenRevealed", "open", "secret"];

const config = (n: number, seed: string, extra: Partial<GameConfig> = {}): GameConfig => ({
  seed,
  players: Array.from({ length: n }, (_, i) => ({ id: `q${i}`, name: `Q${i}`, isBot: true })),
  job: "bank",
  eventsEnabled: true,
  voteVisibility: "hiddenThenRevealed",
  ...extra,
});

const play = (c: GameConfig, agents?: Agent[]) =>
  runBotGame(c, agents ?? createBots(c.players, (_, i) => PERSONALITIES[MIX[i % MIX.length] as PersonalityId], c.seed));

type Claim = Extract<Statement, { kind: "role" }>;
const claimsIn = (log: readonly GameEvent[]): Claim[] => log.flatMap((e) => (e.type === "said" && e.statement.kind === "role" ? [e.statement] : []));

/** Every claim with the claimant's real role at that moment. */
function claimsWithTruth(c: GameConfig, log: readonly GameEvent[]) {
  return log.flatMap((e, i) => (e.type === "said" && e.statement.kind === "role" ? [{ i, claim: e.statement, real: replay(c, log.slice(0, i)).players[e.statement.player]?.role as string }] : []));
}

describe("bot claims in whole games — QA PR #37", () => {
  // Three seeds per cell, plus one more 12-seat game (S3a.1's coins and S3a.5's fewer meetings made bluffs rarer).
  const games = [
    ...[3, 6, 12].flatMap((n) => MODES.flatMap((mode, k) => [0, 1, 2].map((x) => ({ n, mode, c: config(n, `qa37-${n}-${k}${x ? `-${x}` : ""}`, { voteVisibility: mode }) })))),
    { n: 12, mode: "hiddenThenRevealed" as const, c: config(12, "qa37-12-11") },
  ];
  const results = games.map((g) => ({ ...g, r: play(g.c) }));

  it("all-bot games finish in every vote mode at 3, 6 and 12 players with zero refused commands — design §17.3", () => {
    for (const { n, mode, r } of results) {
      expect(r.state.phase.kind, `${n}p ${mode}`).toBe("ended");
      expect(r.rejections, `${n}p ${mode}`).toEqual([]);
    }
    // Bots do claim (otherwise the rest of this file proves nothing).
    expect(results.flatMap(({ r }) => claimsIn(r.state.log)).length).toBeGreaterThan(0);
  });

  it("every claim is a public said entry carrying only player, role and stretch; one per player per stretch — design §11.3", () => {
    for (const { r } of results) {
      for (const e of r.state.log) if (e.type === "said" && e.statement.kind === "role") expect(e.visibility).toEqual({ kind: "public" });
      const claims = claimsIn(r.state.log);
      for (const c of claims) {
        expect(Object.keys(c).sort()).toEqual(["kind", "player", "role", "stretch"]);
        expect(Object.hasOwn(ROLES, c.role)).toBe(true);
      }
      const keys = claims.map((c) => `${c.player}/${c.stretch}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("the Mole, the Fixer and evidence-leaving bots bluff only safe roles nobody else had claimed (or repeat their own story); the rest tell the truth — design §19.3", () => {
    let bluffed = 0;
    for (const { c, r } of results) {
      for (const { i, claim, real } of claimsWithTruth(c, r.state.log)) {
        if (!bluffs(real)) {
          expect(claim.role, `crew bot ${claim.player} tells the truth`).toBe(real);
          continue;
        }
        bluffed++;
        const before = claimsIn(r.state.log.slice(0, i));
        if (before.some((b) => b.player === claim.player && b.role === claim.role)) continue; // sticking to its story
        expect(SAFE_BLUFFS).toContain(claim.role);
        expect(before.filter((b) => b.role === claim.role).map((b) => b.player), `${c.seed}: ${claim.player} bluffs ${claim.role}`).toEqual([]);
      }
    }
    expect(bluffed).toBeGreaterThan(0);
  });

  it("same seed → same claims (and same log) — design §17.2", () => {
    for (const { c, r } of results.filter((x) => x.n === 6)) expect(play(c).state.log).toEqual(r.state.log);
  });
});

/** A person who proposes the next meeting's time while none is set and otherwise only backs proposals (no move: default moves). */
function person(id: string, proposeEarly: boolean): Agent {
  return {
    player: id,
    act(view: PlayerView): PlayerCommand[] {
      if (view.scheduledMeeting || view.phase.kind !== "planning") return [];
      if (proposeEarly && view.proposals.length === 0 && !view.proposals.some((p) => p.by === id)) {
        return [{ type: "proposeMeeting", player: id, slot: `human-${view.stretch}` }];
      }
      return [];
    },
  };
}

describe("meeting proposals with a human seat — QA PR #37, design §11.1", () => {
  const humanSeat = (n: number, seed: string, mode: VoteVisibility): GameConfig => {
    // No bust (design §5.5), so the game reaches its meetings.
    const c = config(n, seed, { voteVisibility: mode, contentOverrides: { alarm: { bustStars: 99 } } });
    return { ...c, players: c.players.map((p, i) => (i === 0 ? { ...p, isBot: false } : p)) };
  };
  const bots = (c: GameConfig) => createBots(c.players.slice(1), (_, i) => PERSONALITIES[MIX[i % MIX.length] as PersonalityId], c.seed);

  it("bots never propose a slot: with no person proposing, the server picks every meeting's slot (STATUS bot scheduling)", () => {
    for (const [n, k] of [[3, 0], [6, 1], [12, 2]] as const) {
      const c = humanSeat(n, `qa37-h-${n}`, MODES[k] as VoteVisibility);
      const r = play(c, [person("q0", false), ...bots(c)]);
      expect(r.rejections).toEqual([]);
      expect(r.state.log.filter((e) => e.type === "meetingProposed"), `${n}p`).toEqual([]);
      const scheduled = r.state.log.filter((e): e is Extract<GameEvent, { type: "meetingScheduled" }> => e.type === "meetingScheduled");
      expect(scheduled.length).toBeGreaterThan(0);
      expect(scheduled.every((e) => e.proposalId === null)).toBe(true);
    }
  });

  it("bots back a person's early proposal, propose none of their own, and its slot is the one locked in", () => {
    for (const n of [3, 6, 12]) {
      const c = humanSeat(n, `qa37-hp-${n}`, "open");
      const r = play(c, [person("q0", true), ...bots(c)]);
      expect(r.rejections).toEqual([]);
      const proposed = r.state.log.filter((e): e is Extract<GameEvent, { type: "meetingProposed" }> => e.type === "meetingProposed");
      expect(proposed.length).toBeGreaterThan(0);
      expect(proposed.every((e) => e.by === "q0"), `${n}p: only the person proposes`).toBe(true);
      const scheduled = r.state.log.filter((e): e is Extract<GameEvent, { type: "meetingScheduled" }> => e.type === "meetingScheduled");
      const human = new Set(proposed.map((p) => p.proposalId));
      const locked = scheduled.filter((x) => x.proposalId !== null);
      expect(locked.length, `${n}p: a person's slot is locked in`).toBeGreaterThan(0);
      for (const s of locked) expect(human.has(s.proposalId as string), `${n}p ${s.meetingId} locked on the person's slot`).toBe(true);
    }
  });
});

describe("double claims in the suspicion model — QA PR #37, v2 §4", () => {
  it("a second claimant of a role dealt once raises suspicion of the first one too, privately and publicly — design §15.4", () => {
    const base = game(5, { ana: "auditor", ben: "hacker", carl: "priest", dee: "lookout", eve: "mole" });
    const one = run(base, { type: "claimRole", player: "ben", role: "lookout" });
    const two = run(one, { type: "claimRole", player: "carl", role: "lookout" });
    for (const id of ["ben", "carl"]) {
      expect(suspicion(viewFor(two, "ana")).get(id) ?? 0).toBeGreaterThan(suspicion(viewFor(one, "ana")).get(id) ?? 0);
      expect(publicSuspicion(viewFor(two, "ana")).get(id) ?? 0).toBeGreaterThan(publicSuspicion(viewFor(one, "ana")).get(id) ?? 0);
    }
  });
});
