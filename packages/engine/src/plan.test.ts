// The plan board's snapshot as a public said event as a round resolves. design §10, §18, §19.2 seam 5
import { describe, expect, it } from "vitest";
import type { Command, GameConfig, GameState, PlanSnapshot } from "./types";
import { PUBLIC } from "./types";
import { createGame } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { revealSummary } from "./reveal";
import { fullGrab } from "./grab.testkit";
import { sampleEvents } from "./types/samples";

const cfg: GameConfig = {
  seed: "plan-seed",
  players: ["p0", "p1", "p2"].map((id) => ({ id, name: id.toUpperCase(), isBot: false })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
};
const start = createGame(cfg);
const resolve = (plan?: unknown): Command => ({ type: "advance", deadline: { kind: "round", round: 1, plan } }) as Command;

const PLAN: PlanSnapshot = {
  entries: [
    { player: "p0", placed: "vault", room: "vault", power: { role: "hacker", target: "vault" }, agreed: true },
    { player: "p1", placed: null, room: "lobby", power: { role: "detective", target: "p0" }, agreed: false },
  ],
  history: [
    { actor: "p1", kind: "place", subject: "p0", value: "vault", target: null, msBeforeDeadline: 300_000 },
    { actor: "p0", kind: "room", subject: "p0", value: "vault", target: null, msBeforeDeadline: 120_000 },
  ],
};

function ok(state: GameState, command: Command) {
  const r = handleCommand(state, command);
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r;
}

describe("the plan-board snapshot — design §10", () => {
  it("goes into the log as one public said event as the round resolves, before what really happened", () => {
    const moved = ok(start, { type: "submitMove", player: "p0", move: fullGrab("office") } as Command).state;
    const { state, events } = ok(moved, resolve(PLAN));
    expect(events[0]).toEqual({ type: "said", visibility: PUBLIC, statement: { kind: "plan", round: 1, plan: PLAN } });
    expect(events.slice(1).some((e) => e.type === "said")).toBe(false);
    for (const viewer of ["p0", "p1", "p2"]) expect(viewFor(state, viewer).ledger.some(({ event }) => event.type === "said")).toBe(true);
    expect(replay(cfg, state.log)).toEqual(state);
  });

  it("changes nothing else: the round resolves exactly as without it (no RNG draw of its own)", () => {
    const withPlan = ok(start, resolve(PLAN));
    const without = ok(start, resolve());
    expect(withPlan.events.slice(1)).toEqual(without.events);
    expect({ ...withPlan.state, log: without.state.log }).toEqual(without.state);
  });

  it("every kind of edit is kept as made, cleared ones included", () => {
    const history = [
      { actor: "p0", kind: "room", subject: "p0", value: null, target: null, msBeforeDeadline: null },
      { actor: "p0", kind: "power", subject: "p0", value: "detective", target: "p1", msBeforeDeadline: 5 },
      { actor: "p0", kind: "power", subject: "p0", value: null, target: null, msBeforeDeadline: 4 },
      { actor: "p2", kind: "agree", subject: "p2", value: "false", target: null, msBeforeDeadline: 3 },
      { actor: "p2", kind: "place", subject: "p1", value: null, target: null, msBeforeDeadline: 2 },
    ];
    expect(ok(start, resolve({ entries: [], history })).events[0]).toMatchObject({ statement: { plan: { entries: [], history } } });
  });

  it("comes before the round's nameless sales, in a fixed order that hides who bought what — design §10, §12, §18", () => {
    // p0 and p2 both buy as planning closes; the board names neither purchase.
    const p = (id: string) => ({ ...(start.players[id] as GameState["players"][string]), stash: 9 });
    const shop: GameState = { ...start, shop: ["tail", "softShoes", "bail"], players: { ...start.players, p0: p("p0"), p2: p("p2") } };
    const bought = [
      { type: "buyPerk", player: "p2", perk: { kind: "softShoes" } },
      { type: "buyPerk", player: "p0", perk: { kind: "tail", room: "vault" } },
    ] as Command[];
    const s = bought.reduce((x, c) => ok(x, c).state, shop);
    const types = (plan?: unknown) => ok(s, resolve(plan)).events.map((e) => e.type);
    const withBoard = types(PLAN);
    expect(withBoard.slice(0, 3)).toEqual(["said", "perkSold", "perkSold"]);
    // The board changes nothing after it: the sales and the round's facts come out the same with or without it.
    expect(withBoard.slice(1)).toEqual(types());
    // Bought in the other order, the log after the board is the same for everyone else.
    const swapped = [...bought].reverse().reduce((x, c) => ok(x, c).state, shop);
    const pub = (st: GameState) => ok(st, resolve(PLAN)).events.filter((e) => e.visibility.kind === "public");
    expect(pub(swapped)).toEqual(pub(s));
  });

  it("nothing said, nothing logged: an omitted or empty board adds no event", () => {
    for (const plan of [undefined, { entries: [], history: [] }]) expect(ok(start, resolve(plan)).events.some((e) => e.type === "said")).toBe(false);
  });

  it("keeps only known fields, in seat order (whatever order the board came in)", () => {
    const p2 = { player: "p2", placed: "office", room: null, power: null, agreed: true, secret: "mole" };
    const p0 = { ...PLAN.entries[0], extra: 1 };
    const { events } = ok(start, resolve({ entries: [p2, p0], history: [{ ...PLAN.history[0], at: "2026-11-09T10:00:00Z" }], note: "x" }));
    expect(events[0]).toEqual({
      type: "said",
      visibility: PUBLIC,
      statement: { kind: "plan", round: 1, plan: { entries: [PLAN.entries[0], { player: "p2", placed: "office", room: null, power: null, agreed: true }], history: [PLAN.history[0]] } },
    });
  });

  it("the reveal replays each seat's plan spot against its real room — design §15.5", () => {
    const moved = ok(start, { type: "submitMove", player: "p0", move: fullGrab("office") } as Command).state;
    const s = ok(moved, resolve(PLAN)).state;
    const round1 = revealSummary(s.log, sampleEvents.gameEnded.outcome).rounds.find((r) => r.round === 1)!;
    expect(round1.moves.map((m) => [m.player, m.room, m.planned])).toEqual([
      ["p0", "office", "vault"],
      ["p1", "lobby", "lobby"],
      ["p2", "lobby", null],
    ]);
  });

  const entry = PLAN.entries[0]!;
  const edit = PLAN.history[0]!;
  const bad: [string, unknown][] = [
    ["not an object", "plan"],
    ["no history", { entries: [] }],
    ["entries not a list", { entries: {}, history: [] }],
    ["unknown player", { entries: [{ ...entry, player: "zed" }], history: [] }],
    ["prototype key as player", { entries: [{ ...entry, player: "__proto__" }], history: [] }],
    ["a seat twice", { entries: [entry, entry], history: [] }],
    ["room not in play", { entries: [{ ...entry, room: "depositBoxes" }], history: [] }],
    ["placed on no room", { entries: [{ ...entry, placed: "kitchen" }], history: [] }],
    ["agreed not a boolean", { entries: [{ ...entry, agreed: "yes" }], history: [] }],
    ["power on an unknown role", { entries: [{ ...entry, power: { role: "chef", target: "vault" } }], history: [] }],
    ["power of a role with no claimable power", { entries: [{ ...entry, power: { role: "locksmith", target: "vault" } }], history: [] }],
    ["room power on a player", { entries: [{ ...entry, power: { role: "hacker", target: "p1" } }], history: [] }],
    ["player power on yourself", { entries: [{ ...entry, power: { role: "detective", target: "p0" } }], history: [] }],
    ["history kind unknown", { entries: [], history: [{ ...edit, kind: "vote" }] }],
    ["history actor unknown", { entries: [], history: [{ ...edit, actor: "zed" }] }],
    ["history value not text", { entries: [], history: [{ ...edit, value: 3 }] }],
    ["history time not a number", { entries: [], history: [{ ...edit, msBeforeDeadline: "soon" }] }],
    ["a room claim made for someone else", { entries: [], history: [{ ...edit, kind: "room" }] }],
    ["a place edit naming no room", { entries: [], history: [{ ...edit, value: "kitchen" }] }],
    ["a place edit with a target", { entries: [], history: [{ ...edit, target: "vault" }] }],
    ["an agree edit saying neither", { entries: [], history: [{ actor: "p0", kind: "agree", subject: "p0", value: "maybe", target: null, msBeforeDeadline: null }] }],
    ["a power edit naming no role", { entries: [], history: [{ actor: "p0", kind: "power", subject: "p0", value: "chef", target: "vault", msBeforeDeadline: null }] }],
    ["a power edit aimed wrong", { entries: [], history: [{ actor: "p0", kind: "power", subject: "p0", value: "hacker", target: "p1", msBeforeDeadline: null }] }],
  ];
  for (const [name, plan] of bad) {
    it(`a bad board is refused with the round unresolved: ${name}`, () => {
      const r = handleCommand(start, resolve(plan));
      expect(r.ok).toBe(false);
      expect(start.phase).toEqual({ kind: "planning", round: 1 });
    });
  }
});
