// QA for PR #64: crewSeed is required; the public gameDigest fallback is gone.
// Determinism (same seed + same crewSeed => same commands and log), the hunch
// follows the crewSeed, and the public data gameDigest used to read (seat
// names, round haul/heat) no longer moves it. design §17.3 (bots are players); PR #37 review
import { viewFor, type GameConfig, type PlayerCommand, type PlayerView } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { createBot, crewHunch, type Agent } from "./bot";
import { PERSONALITIES } from "./personalities";
import { runBotGame } from "./run";

const KINDS = ["greedy", "honest", "cautious"] as const;

const config = (seed: string, n: number): GameConfig => ({
  seed,
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Bot ${i + 1}`, isBot: true })),
  job: "bank",
  rolePool: ["rookie"],
  uniqueRoles: false,
  mole: "off",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
});

/** Bots with fixed per-seat seeds; only the crewSeed varies. Records every command each bot emits. */
function recordedBots(n: number, crewSeed: string) {
  const sent: PlayerCommand[] = [];
  const meetingViews: PlayerView[] = [];
  const agents: Agent[] = Array.from({ length: n }, (_, i) => {
    const bot = createBot({ player: `p${i + 1}`, personality: PERSONALITIES[KINDS[i % 3]!], seed: `bot/${i}`, crewSeed });
    return {
      player: bot.player,
      act: (view: PlayerView) => {
        if (view.phase.kind === "meeting" && i === 0) meetingViews.push(view);
        const out = bot.act(view);
        sent.push(...out);
        return out;
      },
    };
  });
  return { agents, sent, meetingViews };
}

const play = (seed: string, n: number, crewSeed: string) => {
  const r = recordedBots(n, crewSeed);
  const result = runBotGame(config(seed, n), r.agents);
  return { ...r, result };
};

describe("QA PR #64: crewSeed required", () => {
  for (const n of [3, 8, 12]) {
    it(`${n} players: same seed + same crewSeed => identical bot commands and event log, no refusals`, () => {
      const a = play(`qa64-${n}`, n, "crew-A");
      const b = play(`qa64-${n}`, n, "crew-A");
      expect(a.result.rejections).toEqual([]);
      expect(JSON.stringify(b.sent)).toBe(JSON.stringify(a.sent));
      expect(JSON.stringify(b.result.state.log)).toBe(JSON.stringify(a.result.state.log));
      expect(a.result.state.phase.kind).toBe("ended");
    });
  }

  it("different crewSeed => the hunch differs for the same meeting view", () => {
    const { meetingViews } = play("qa64-hunch", 6, "crew-A");
    expect(meetingViews.length).toBeGreaterThan(0);
    const view = meetingViews[0]!;
    for (const p of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
      const hunches = Array.from({ length: 8 }, (_, i) => crewHunch(view, p, `crew-${i}`));
      expect(new Set(hunches).size, p).toBe(hunches.length);
      for (const h of hunches) expect(Math.abs(h)).toBeLessThanOrEqual(1);
    }
  });

  it("over many games, changing only the crewSeed changes some game's commands", () => {
    let differ = 0;
    for (let g = 0; g < 10; g++) {
      const a = play(`qa64-var-${g}`, 6, "crew-A");
      const b = play(`qa64-var-${g}`, 6, "crew-B");
      if (JSON.stringify(a.sent) !== JSON.stringify(b.sent)) differ++;
    }
    expect(differ).toBeGreaterThan(0);
  });

  it("changing only the public data the old gameDigest read (seat names, round haul/heat) does not change the hunch", () => {
    const { meetingViews } = play("qa64-digest", 6, "crew-A");
    const view = meetingViews[0]!;
    const tamper = (x: unknown): unknown => {
      if (Array.isArray(x)) return x.map(tamper);
      if (x && typeof x === "object") {
        const o: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(x)) {
          if (k === "name" && typeof v === "string") o[k] = `Renamed ${v}`;
          else if ((k === "haul" || k === "heat") && typeof v === "number") o[k] = v + 7;
          else o[k] = tamper(v);
        }
        return o;
      }
      return x;
    };
    const forged = tamper(view) as PlayerView;
    expect(JSON.stringify(forged)).not.toBe(JSON.stringify(view));
    for (const p of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
      expect(crewHunch(forged, p, "crew-A"), p).toBe(crewHunch(view, p, "crew-A"));
    }
  });

  it("the hunch is the same for every bot at the table (shared crewSeed)", () => {
    const { result } = play("qa64-shared", 6, "crew-A");
    const ids = result.state.playerOrder;
    for (const target of ids) {
      const seen = new Set(ids.map((me) => crewHunch(viewFor(result.state, me), target, "crew-A")));
      expect(seen.size, target).toBe(1);
    }
  });
});
