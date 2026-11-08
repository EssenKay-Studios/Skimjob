// QA (PR #51): the R6 bot settings — ★ lean point 0.8
// below suspicion 2 — and the bot rules they must keep: votes on suspicion
// only, same seed → same game. extension.md Build notes "Bots", design §8, §11.3
import { describe, expect, it } from "vitest";
import { viewFor, type GameEvent, type GameState } from "@skimjob/engine";
import { botRandom, chooseVote, decide } from "./bot";
import { forecast, LEAN_AT, leaning } from "./forecast";
import { PERSONALITIES, type Personality } from "./personalities";
import { createBots, runBotGame } from "./run";
import { suspicion } from "./suspicion";
import { closeAlibis, config, game, round } from "./testkit";

type Player = GameState["players"][string];
const exact: Personality = { ...PERSONALITIES.honest, noise: 0, misread: 0, hunch: 0 };
const withRole = (s: GameState, id: string, role: string, me: Partial<Player> = {}): GameState => {
  const p = s.players[id] as Player;
  return { ...s, players: { ...s.players, [id]: { ...p, role, ...me } } };
};
const addLog = (s: GameState, ...events: GameEvent[]): GameState => ({ ...s, log: [...s.log, ...events] });
const PUBLIC = { kind: "public" } as const;

describe("QA #51: ★ lean point 0.8 — extension.md Build notes \"Bots\" [0.8]", { timeout: 10_000 }, () => {
  it("LEAN_AT is 0.8", () => expect(LEAN_AT).toBe(0.8));
});

describe("QA #51: votes are on suspicion only — extension.md Build notes \"Bots\"", { timeout: 10_000 }, () => {
  it("a leaning ★ bot votes exactly as a team player with the same view would", () => {
    // Two rounds with every coin pocketed: a top-rated Mole leans toward theft (design §8.4).
    let cold = game(5);
    for (let r = 0; r < 2; r++) cold = round(cold, Object.fromEntries(cold.playerOrder.map((id) => [id, { room: "lobby", pocket: 2 }])));
    const base = addLog({ ...closeAlibis(cold), phase: { kind: "meeting", meetingId: "meeting-1" } }, {
      type: "shakedownResolved", visibility: PUBLIC, meetingId: "emergency-x", target: "ben", stashRevealed: 7, taken: 7, clean: false,
    });
    const star = withRole(base, "ana", "mole", { stash: 10 });
    expect(leaning(viewFor(star, "ana"))).toBe("theft");
    for (const role of ["rookie", "fixer", "mole", "hacker"]) {
      for (const seed of ["v1", "v2", "v3"]) {
        expect(chooseVote(viewFor(withRole(base, "ana", role, { stash: 10 }), "ana"), PERSONALITIES.honest, botRandom(seed), "test-crew")).toEqual(
          chooseVote(viewFor(star, "ana"), PERSONALITIES.honest, botRandom(seed), "test-crew"),
        );
      }
    }
  });
});

