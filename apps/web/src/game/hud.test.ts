// Game screen helpers, from real engine views. docs/m2-plan.md M2-6
import { createGame, handleCommand, viewFor, type GameConfig, type GameState, type PlayerCommand, type SystemCommand } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import {
  alibiState,
  canPocket,
  formatCountdown,
  justMissed,
  namesOf,
  nextTarget,
  outcomeOf,
  phaseInfo,
  remainingMs,
  roomOptions,
  seatsOf,
  timerFor,
} from "./hud";

const config = (n = 4, extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: "hud-test",
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: i === 0 ? "Ana" : `Bot · ${i}`, isBot: i > 0 })),
  job: "bank",
  rolePool: ["rookie"],
  mole: "off",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  starterMode: true,
  uniqueRoles: false,
  ...extra,
});

function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}
const round = (r: number): SystemCommand => ({ type: "advance", deadline: { kind: "round", round: r } });
const alibis = (r: number): SystemCommand => ({ type: "advance", deadline: { kind: "alibis", round: r } });

describe("HUD", () => {
  it("names the phase and its deadline: planning, alibis (design §5, §5.4)", () => {
    let s = createGame(config());
    expect(phaseInfo(viewFor(s, "p1"))).toEqual({ title: "Planning: pick a room", timerKey: "round:1", timerLabel: "locks in" });
    s = run(s, round(1));
    expect(phaseInfo(viewFor(s, "p1"))).toEqual({ title: "Alibi window", timerKey: "alibis:1", timerLabel: "alibis close in" });
  });

  it("races the act's checkpoint: per-player target × crew (design §11.5)", () => {
    const v = viewFor(createGame(config(4)), "p1");
    expect(nextTarget(v)).toEqual({ act: 1, target: 7 * 4, final: false });
  });

  it("counts down from the server clock, frozen while paused", () => {
    const t = { key: "round:1", dueAt: 10_000, pausedAt: null };
    expect(remainingMs(t, 4_000)).toBe(6_000);
    expect(remainingMs(t, 12_000)).toBe(0);
    expect(remainingMs({ ...t, pausedAt: 7_000 }, 99_000)).toBe(3_000);
    expect(timerFor([t], "round:1")).toBe(t);
    expect(timerFor([t], "round:2")).toBeNull();
    expect(timerFor([t], null)).toBeNull();
  });

  it.each([
    [0, "0:00"],
    [400, "0:01"],
    [42_000, "0:42"],
    [12 * 60_000 + 5_000, "12:05"],
    [4 * 3600_000 + 12 * 60_000, "4h 12m"],
    [51 * 3600_000, "2d 3h"],
  ])("formats %d ms as %s", (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
});

describe("seats", () => {
  it("lists everyone in seat order and marks only your own move as submitted", () => {
    let s = createGame(config(3));
    expect(seatsOf(viewFor(s, "p2")).map((x) => [x.id, x.you, x.moved])).toEqual([
      ["p1", false, false],
      ["p2", true, false],
      ["p3", false, false],
    ]);
    s = run(s, { type: "submitMove", player: "p1", move: { room: "office", pocket: 0 } });
    // p1's move is hidden from p2 (design §5.1); p1 sees its own mark.
    expect(seatsOf(viewFor(s, "p2")).some((x) => x.moved)).toBe(false);
    expect(seatsOf(viewFor(s, "p1")).find((x) => x.you)!.moved).toBe(true);
    expect(namesOf(viewFor(s, "p1"))("p2")).toBe("Bot · 1");
  });
});

describe("move panel", () => {
  it("offers the rooms in play with loot and Heat hints (design §6, §7)", () => {
    const opts = roomOptions(viewFor(createGame(config(5)), "p1"));
    const by = Object.fromEntries(opts.map((o) => [o.id, o]));
    expect(opts.map((o) => o.id)).toEqual(["vault", "office", "lobby", "security", "rooftop", "depositBoxes", "serverRoom"]);
    expect(by.vault).toMatchObject({ loot: 6, heat: "up", watcher: false, closed: false });
    expect(by.rooftop).toMatchObject({ loot: 0, heat: "down" });
    expect(by.security).toMatchObject({ watcher: true, notes: ["watch one room"] });
    expect(by.depositBoxes!.notes).toEqual(["more than 2 here: 4 each"]);
  });

  it("shows a missed deadline's default move (design §5.1)", () => {
    let s = createGame(config(2));
    s = run(s, { type: "submitMove", player: "p2", move: { room: "office", pocket: 0 } }, round(1));
    expect(justMissed(viewFor(s, "p1"))).toEqual({ round: 1, room: "lobby" });
    expect(justMissed(viewFor(s, "p2"))).toBeNull();
    s = run(s, alibis(1));
    expect(justMissed(viewFor(s, "p1"))).toEqual({ round: 1, room: "lobby" });
    s = run(s, { type: "submitMove", player: "p1", move: { room: "office", pocket: 0 } }, round(2));
    expect(justMissed(viewFor(s, "p1"))).toBeNull();
  });

  it("knows who may pocket (design §8: the Inside Man may not)", () => {
    expect(canPocket(viewFor(createGame(config(2)), "p1"))).toBe(true);
    const s = createGame(config(5, { rolePool: ["insideMan"], starterMode: false }));
    expect(s.players.p1!.role).toBe("insideMan");
    expect(canPocket(viewFor(s, "p1"))).toBe(false);
  });
});

describe("alibis", () => {
  it("opens for the resolved round and remembers your claim (design §5.4)", () => {
    let s = createGame(config(2));
    expect(alibiState(viewFor(s, "p1"))).toBeNull();
    s = run(s, round(1));
    expect(alibiState(viewFor(s, "p1"))).toEqual({ round: 1, posted: null });
    s = run(s, { type: "postAlibi", player: "p1", room: "vault" });
    expect(alibiState(viewFor(s, "p1"))).toEqual({ round: 1, posted: "vault" });
    expect(alibiState(viewFor(s, "p2"))).toEqual({ round: 1, posted: null });
  });
});

describe("game over", () => {
  it("has no outcome until the game ends", () => {
    expect(outcomeOf(viewFor(createGame(config(2)), "p1"))).toBeNull();
  });
});
