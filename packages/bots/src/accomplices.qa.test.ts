// QA for role deck v2 R3a (PR #32): in all-bot games at 6–12 players with a
// saboteur and events on, every `alliesLearned` names the right people at the
// right moment (folded state just before the event). design §8, §8.1 (v2 §2)
import { describe, expect, it } from "vitest";
import { ROLES } from "@skimjob/content";
import { applyEvent, replay, type GameConfig, type GameState, type PlayerState } from "@skimjob/engine";
import { PERSONALITIES, type PersonalityId } from "./personalities";
import { createBots, runBotGame } from "./run";

const MIXED: PersonalityId[] = ["honest", "opportunist", "cautious", "greedy", "random"];
const faction = (s: GameState, id: string) => ROLES[(s.players[id] as PlayerState).role]?.faction ?? "crew";

describe("QA: what the dark side learns in bot games — v2 §2", () => {
  it.each([6, 9, 12])("%i players: knowledge matches roles, Heat and safe at the time; no refused command", (n) => {
    const vias = new Set<string>();
    for (let g = 0; g < 4; g++) {
      const c: GameConfig = {
        seed: `qa-dark-${n}-${g}`,
        players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
        job: "bank",
        rolePool: ["getawayDriver", "fence", "hacker", "lookout", "rookie", "bagman", "auditor", "cleaner"],
        mole: "on",
        eventsEnabled: true,
        voteVisibility: "hiddenThenRevealed",
        starterMode: false,
      };
      const { state, rejections } = runBotGame(c, createBots(c.players, (_, i) => PERSONALITIES[MIXED[i % MIXED.length] as PersonalityId], `b-${c.seed}`));
      expect([state.phase.kind, rejections]).toEqual(["ended", []]);
      let s = replay(c, []);
      for (const e of state.log) {
        if (e.type === "alliesLearned") {
          vias.add(e.via);
          const me = s.players[e.player] as PlayerState;
          const role = me.role;
          if (e.via === "deal") expect([role, e.allies.map((a) => faction(s, a))]).toEqual(["hacker", ["saboteur"]]);
          if (e.via === "fence") {
            expect([role, me.safe >= 10, e.allies.map((a) => faction(s, a))]).toEqual(["fence", true, ["saboteur"]]);
          }
          if (e.via === "tipOff") expect([faction(s, e.player), e.allies.map((a) => faction(s, a))]).toEqual(["saboteur", ["accomplice"]]);
          if (e.via === "getaway") {
            expect(s.heat).toBeGreaterThanOrEqual(75);
            if (role === "getawayDriver") expect(e.allies.every((a) => faction(s, a) === "saboteur")).toBe(true);
            else expect([faction(s, e.player), e.allies.map((a) => (s.players[a] as PlayerState).role)]).toEqual(["saboteur", ["getawayDriver"]]);
          }
          if (e.via !== "getaway") for (const a of e.allies) expect(me.roleState.allies, `${e.via} repeats ${a}`).not.toContain(a);
        }
        s = applyEvent(s, e);
      }
    }
    expect(vias.has("tipOff") || vias.has("deal")).toBe(true);
  }, 120_000);
});
