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
import { config, game } from "./testkit";

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

  it("a top-rated ★ role plays for success while its failure's forecast is 0.4–0.8, and leans from 0.8 on", () => {
    const at = (heat: number) => withRole({ ...game(5), heat }, "ana", "mole", { stash: 10 });
    const heats = Array.from({ length: 100 }, (_, h) => h).map((h) => ({ h, f: forecast(viewFor(at(h), "ana")).heat }));
    const middle = heats.filter((x) => x.f >= 0.4 && x.f < LEAN_AT);
    const over = heats.filter((x) => x.f >= LEAN_AT);
    expect(middle.length).toBeGreaterThan(0); // the old lean zone exists…
    expect(over.length).toBeGreaterThan(0);
    for (const { h } of middle) expect(leaning(viewFor(at(h), "ana")), `heat ${h}`).toBeNull(); // …and no longer leans
    for (const { h } of over) expect(leaning(viewFor(at(h), "ana")), `heat ${h}`).toBe("heat");
    // A team role never leans, however hot.
    expect(leaning(viewFor(withRole({ ...game(5), heat: 99 }, "ana", "fixer", { stash: 10 }), "ana"))).toBeNull();
  });
});

describe("QA #51: votes are on suspicion only — extension.md Build notes \"Bots\"", { timeout: 10_000 }, () => {
  it("a leaning ★ bot votes exactly as a team player with the same view would", () => {
    const base = addLog({ ...game(5), heat: 95, phase: { kind: "meeting", meetingId: "act-1" } }, {
      type: "shakedownResolved", visibility: PUBLIC, meetingId: "emergency-x", target: "ben", stashRevealed: 7, taken: 7, clean: false, compensation: 0,
    });
    const star = withRole(base, "ana", "mole", { stash: 10 });
    expect(leaning(viewFor(star, "ana"))).toBe("heat");
    for (const role of ["rookie", "fixer", "mole", "hacker"]) {
      for (const seed of ["v1", "v2", "v3"]) {
        expect(chooseVote(viewFor(withRole(base, "ana", role, { stash: 10 }), "ana"), PERSONALITIES.honest, botRandom(seed), "test-crew")).toEqual(
          chooseVote(viewFor(star, "ana"), PERSONALITIES.honest, botRandom(seed), "test-crew"),
        );
      }
    }
  });
});

