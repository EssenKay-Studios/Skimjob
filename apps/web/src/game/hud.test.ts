// Game screen helpers, from real engine views. docs/m2-plan.md M2-6
import { BANK_JOB } from "@skimjob/content";
import { handleCommand, viewFor, type GameConfig, type GameState, type PlayerCommand, type SystemCommand } from "@skimjob/engine";
import { createGame } from "./deal.testkit";
import { describe, expect, it } from "vitest";
import { presenceOf } from "./useGame";
import {
  agoText,
  alibiState,
  bankTotal,
  formatCountdown,
  jobOf,
  justMissed,
  namesOf,
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
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
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

describe("HUD", () => {
  it("names the phase and its deadline: planning, then the result window (design §5, §9.3)", () => {
    let s = createGame(config());
    expect(phaseInfo(viewFor(s, "p1"))).toEqual({ title: "Planning: pick a room", timerKey: "round:1", timerLabel: "locks in" });
    s = run(s, round(1));
    expect(phaseInfo(viewFor(s, "p1"))).toEqual({ title: "Round 1 result", timerKey: "result:1", timerLabel: "next round in" });
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

describe("bank count", () => {
  it("is the pile per player times the crew, with any content overrides (design §6.1)", () => {
    expect(bankTotal(viewFor(createGame(config(4)), "p1"))).toBe(BANK_JOB.bank.coinsPerPlayer * 4);
    expect(bankTotal(viewFor(createGame(config(3)), "p1"))).toBe(viewFor(createGame(config(3)), "p1").bank);
    const custom = config(3, { contentOverrides: { bank: { coinsPerPlayer: 5 }, roundCap: 7 } });
    const v = viewFor(createGame(custom), "p1");
    expect(bankTotal(v)).toBe(15);
    expect(jobOf(v).roundCap).toBe(7);
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
    s = run(s, { type: "submitMove", player: "p1", move: { room: "office", duffel: 2, pocket: 0 } });
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
    expect(timerFor([early, { key: "result:2", dueAt: 1, pausedAt: null }], "result:2")?.key).toBe("result:2");
  });
});

describe("move panel", () => {
  it("offers the rooms in play with their coins and bells (design §3.1, §5.1)", () => {
    const opts = roomOptions(viewFor(createGame(config(5)), "p1"));
    const by = Object.fromEntries(opts.map((o) => [o.id, o]));
    expect(opts.map((o) => o.id)).toEqual(["vault", "office", "lobby", "security", "rooftop", "depositBoxes", "serverRoom"]);
    expect(by.vault).toMatchObject({ coins: 3, bell: "Bell 0 of 5", watcher: false, closed: null });
    expect(by.serverRoom).toMatchObject({ coins: 2, notes: [] });
    expect(by.rooftop).toMatchObject({ coins: 0, bell: "Bell 0 of 5" });
    expect(by.security).toMatchObject({ watcher: true, notes: ["watch one room"] });
    expect(by.depositBoxes).toMatchObject({ coins: 2, notes: [] }); // no visitor limit (design §3.2)
  });

  it("notes a Shift change surge with the right plural, and a short row of coins (design §13)", () => {
    const surge = (extraCoins: number) => {
      const v = viewFor(createGame(config(5, { contentOverrides: { events: { shiftChange: { extraCoins } } } })), "p1");
      return roomOptions({ ...v, card: { round: v.round, id: "shiftChange", room: null } }).find((o) => o.id === "vault");
    };
    expect(surge(1)).toMatchObject({ coins: 4, notes: ["+1 coin this round"] });
    expect(surge(2)).toMatchObject({ coins: 5, notes: ["+2 coins this round"] });
    expect(surge(0)).toMatchObject({ coins: 3, notes: [] });
  });

  it("shows a missed deadline's default move (design §5.1)", () => {
    let s = createGame(config(3));
    s = run(s, { type: "submitMove", player: "p2", move: { room: "office", duffel: 2, pocket: 0 } }, round(1));
    expect(justMissed(viewFor(s, "p1"))).toEqual({ round: 1, room: "lobby" });
    expect(justMissed(viewFor(s, "p2"))).toBeNull();
    // design §9.3: the result window closes with no emergency called.
    s = run(s, { type: "advance", deadline: { kind: "result", round: 1 } });
    s = run(s, { type: "submitMove", player: "p1", move: { room: "office", duffel: 2, pocket: 0 } }, round(2));
    expect(justMissed(viewFor(s, "p1"))).toBeNull();
  });
});

describe("alibis", () => {
  it("offers the latest resolved round in every phase and remembers your claim (design §11.3)", () => {
    let s = createGame(config(3));
    expect(alibiState(viewFor(s, "p1"))).toBeNull();
    s = run(s, round(1));
    expect(alibiState(viewFor(s, "p1"))).toEqual({ round: 1, posted: null });
    s = run(s, { type: "postAlibi", player: "p1", round: 1, room: "vault" });
    expect(alibiState(viewFor(s, "p1"))).toEqual({ round: 1, posted: "vault" });
    expect(alibiState(viewFor(s, "p2"))).toEqual({ round: 1, posted: null });
    // Also while a meeting is open (a raid's briefing can open at once): still between rounds.
    const meeting = run(s, { type: "callEmergency", player: "p2" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-1" } });
    expect(meeting.phase.kind).toBe("meeting");
    expect(alibiState(viewFor(meeting, "p2"))).toEqual({ round: 1, posted: null });
    // Also while the next round is planned: the engine takes an alibi for any resolved round, in any phase.
    s = run(s, { type: "advance", deadline: { kind: "result", round: 1 } });
    expect(s.phase.kind).toBe("planning");
    expect(alibiState(viewFor(s, "p1"))).toEqual({ round: 1, posted: "vault" });
    expect(alibiState(viewFor(s, "p2"))).toEqual({ round: 1, posted: null });
  });
});

describe("game over", () => {
  it("has no outcome until the game ends", () => {
    expect(outcomeOf(viewFor(createGame(config(3)), "p1"))).toBeNull();
  });
});
