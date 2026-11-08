// QA (PR #125, C2a): Duel is gone and every game needs 3–12 players. A 2-seat
// config is refused; exactly 3 and 12 play to the end with bots; stray Duel
// commands and fields are refused without throwing; 3 seats is deterministic.
import { describe, expect, it } from "vitest";
import { MAX_PLAYERS, MIN_PLAYERS } from "@skimjob/content";
import { COMMAND_TYPES, createGame, handleCommand, replay, setupEvents, validateConfig, type GameConfig } from "@skimjob/engine";
import { PERSONALITIES } from "./personalities";
import { createBots, runBotGame } from "./run";

function config(players: number, extra: Record<string, unknown> = {}): GameConfig {
  return {
    seed: "qa125",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: true,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
  } as GameConfig;
}

const play = (cfg: GameConfig) => runBotGame(cfg, createBots(cfg.players, () => PERSONALITIES.opportunist, cfg.seed));

describe("QA #125: games need 3–12 players", () => {
  it("MIN_PLAYERS is 3 and MAX_PLAYERS 12", () => {
    expect([MIN_PLAYERS, MAX_PLAYERS]).toEqual([3, 12]);
  });

  it("0, 1, 2 and 13 seats are refused by validateConfig, createGame and setupEvents", () => {
    for (const n of [0, 1, 2, 13]) {
      for (const extra of [{}, { eventsEnabled: false }, { deal: "random" }, { duel: true }]) {
        const cfg = config(n, extra);
        expect(validateConfig(cfg)).toContain(`a game needs 3–12 players, got ${n}`);
        expect(() => createGame(cfg)).toThrow(/a game needs 3–12 players/);
        expect(() => setupEvents(cfg)).toThrow(/a game needs 3–12 players/);
      }
    }
  });

  it.each([3, 12])("exactly %i seats play to the end with bots, no refused command", (n) => {
    for (const events of [true, false]) {
      const game = play(config(n, { eventsEnabled: events, seed: `qa125-${n}-${events}` }));
      expect(game.state.phase.kind).toBe("ended");
      expect(game.rejections).toEqual([]);
      expect(game.state.log.some((e) => e.type === "gameEnded")).toBe(true);
    }
  });

  it("same seed + same commands → identical event log at 3 players; a replay rebuilds the same state", () => {
    const cfg = config(3, { seed: "qa125-det" });
    const a = play(cfg);
    const b = play(JSON.parse(JSON.stringify(cfg)) as GameConfig);
    expect(JSON.stringify(b.state.log)).toBe(JSON.stringify(a.state.log));
    expect(JSON.stringify(replay(cfg, a.state.log))).toBe(JSON.stringify(a.state));
  });
});

describe("QA #125: Duel leftovers are refused cleanly", () => {
  it("no command type mentions Duel or call-outs", () => {
    expect(COMMAND_TYPES.filter((t) => /duel|callout/i.test(t))).toEqual([]);
  });

  it("a hand-built callOut command is refused (not thrown) all through a 3-player game, state unchanged", () => {
    const cfg = config(3, { seed: "qa125-callout" });
    const game = play(cfg);
    const cuts = [setupEvents(cfg).length, ...game.state.log.map((_, i) => i).filter((i) => i > 0 && i % 10 === 0), game.state.log.length];
    for (const cut of cuts) {
      const state = replay(cfg, game.state.log.slice(0, cut));
      for (const cmd of [
        { type: "callOut", playerId: "p0", targetId: "p1" },
        { type: "callOut", playerId: "p0", target: "p1" },
        { type: "callOut" },
        { type: "duel", playerId: "p0" },
      ]) {
        const before = JSON.stringify(state);
        let out: ReturnType<typeof handleCommand> | undefined;
        expect(() => (out = handleCommand(state, cmd))).not.toThrow();
        expect(out!.ok).toBe(false);
        expect(JSON.stringify(state)).toBe(before);
      }
    }
  });

  it("a config, or a stored gameCreated, with duel: true plays as a normal 3-player game (the field is ignored)", () => {
    const plain = config(3, { seed: "qa125-duel-field" });
    const withDuel = config(3, { seed: "qa125-duel-field", duel: true });
    expect(validateConfig(withDuel)).toEqual([]);
    expect(JSON.stringify(setupEvents(withDuel))).toBe(JSON.stringify(setupEvents(plain)));
    expect(JSON.stringify(play(withDuel).state.log)).toBe(JSON.stringify(play(plain).state.log));
    const log = setupEvents(plain).map((e) => (e.type === "gameCreated" ? ({ ...e, duel: true } as typeof e) : e));
    const state = replay(plain, log);
    expect(state.phase).toEqual(createGame(plain).phase);
    expect(handleCommand(state, { type: "callOut", playerId: "p0", targetId: "p1" }).ok).toBe(false);
  });
});
