// Game screen helpers, from real engine views. docs/m2-plan.md M2-6
import { createGame, handleCommand, viewFor, type GameConfig, type GameState, type PlayerCommand, type SystemCommand } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { presenceOf } from "./useGame";
import {
  agoText,
  alibiState,
  canPocket,
  formatCountdown,
  justMissed,
  namesOf,
  nextTarget,
  outcomeOf,
  phaseInfo,
  presenceInfo,
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
  it("lists everyone in seat order and marks who has locked in, for everyone (owner decision, 2 Nov; design §5.1)", () => {
    let s = createGame(config(3));
    expect(seatsOf(viewFor(s, "p2")).map((x) => [x.id, x.you, x.lockedIn])).toEqual([
      ["p1", false, false],
      ["p2", true, false],
      ["p3", false, false],
    ]);
    s = run(s, { type: "submitMove", player: "p1", move: { room: "office", pocket: 0 } });
    // p1's lock-in is public; its room and split are not.
    for (const viewer of ["p1", "p2", "p3"]) expect(seatsOf(viewFor(s, viewer)).map((x) => x.lockedIn)).toEqual([true, false, false]);
    expect(viewFor(s, "p2").me.move).toBeNull();
    expect(namesOf(viewFor(s, "p1"))("p2")).toBe("Bot · 1");
  });

  it("presence: online, last seen, not here yet; bots are bots, never online (owner decision, 2 Nov)", () => {
    const now = 10 * 3600_000;
    const seat = (id: string, isBot = false, you = false) => ({ id, isBot, you });
    const presence = { p1: { online: true, lastSeen: 0 }, p2: { online: false, lastSeen: now - 5 * 60_000 }, p3: { online: false, lastSeen: null } };
    expect(presenceInfo(seat("p1"), presence, now)).toEqual({ kind: "online", text: "online" });
    expect(presenceInfo(seat("p2"), presence, now)).toEqual({ kind: "seen", text: "seen 5 min ago" });
    expect(presenceInfo(seat("p3"), presence, now)).toEqual({ kind: "never", text: "not here yet" });
    expect(presenceInfo(seat("p4", true), { ...presence, p4: { online: true, lastSeen: 1 } }, now)).toEqual({ kind: "bot", text: "bot" });
    expect(presenceInfo(seat("p9"), null, now).kind).toBe("unknown");
    expect(presenceInfo(seat("p3", false, true), presence, now).kind).toBe("online");
    expect([agoText(30_000), agoText(3 * 3600_000), agoText(49 * 3600_000), agoText(24 * 3600_000)]).toEqual(["just now", "3 h ago", "2 days ago", "1 day ago"]);
  });

  it("reads a { presence } frame, dropping bad entries", () => {
    expect(presenceOf({ presence: { p1: { online: true, lastSeen: 5 }, p2: { online: "yes", lastSeen: null }, p3: { online: false, lastSeen: null } } })).toEqual({
      p1: { online: true, lastSeen: 5 },
      p3: { online: false, lastSeen: null },
    });
    expect(presenceOf({ view: {} })).toBeNull();
    expect(presenceOf({ presence: [] })).toBeNull();
  });

  it("a round's countdown is the earlier of its deadline and the early end once everyone has locked in (design §4.1)", () => {
    const round = { key: "round:2", dueAt: 50_000, pausedAt: null };
    const early = { key: "roundEarly:2", dueAt: 20_000, pausedAt: null };
    expect(timerFor([round], "round:2")).toBe(round);
    expect(timerFor([round, early], "round:2")).toBe(early);
    expect(timerFor([{ ...early, dueAt: 60_000 }, round], "round:2")).toBe(round);
    expect(timerFor([early, { key: "alibis:2", dueAt: 1, pausedAt: null }], "alibis:2")?.key).toBe("alibis:2");
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
    expect(by.depositBoxes!.notes).toEqual(["more than 2 here: 3 each"]);
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
