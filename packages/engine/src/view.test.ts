// viewFor(): one sample of every event type, every viewer, during and after the
// game; the viewer's own fields; per-viewer numbering; eventsSince. design §13, §17.2
import { STARTER_ROLES } from "@skimjob/content";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { GameConfig, GameEvent, GameState, PlayerView, PrivateVisibility, PublicVisibility, SecretVisibility } from "./types";
import { PUBLIC, REVEAL, privateTo, secretTo } from "./types";
import { sampleEvents } from "./types/samples";
import { createGame, validateConfig } from "./setup";
import { handleCommand } from "./handle";
import { eventsSince, viewFor } from "./view";

const config = (voteVisibility: GameConfig["voteVisibility"] = "hiddenThenRevealed"): GameConfig => ({
  seed: "view",
  players: [
    { id: "ana", name: "Ana", isBot: false },
    { id: "ben", name: "Ben", isBot: true },
    { id: "carl", name: "Carl", isBot: false },
  ],
  job: "bank",
  rolePool: [...STARTER_ROLES], // no Muscle, so no shakedown window (task 12)
  mole: "off",
  eventsEnabled: false,
  voteVisibility,
});

const VIEWERS = ["ana", "ben", "carl"]; // carl owns no sample event
const ended = (s: GameState): GameState => ({ ...s, phase: { kind: "ended", outcome: sampleEvents.gameEnded.outcome } });
const withEvent = (s: GameState, event: GameEvent): GameState => ({ ...s, log: [...s.log, event] });
// Views are copies (never the state's own objects), so events are compared by value.
const has = (list: readonly { event: GameEvent }[], event: GameEvent) => list.some((e) => isDeepStrictEqual(e.event, event));

function run(state: GameState, ...commands: unknown[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleCommand(s, c);
    if (!r.ok) throw new Error(`rejected: ${r.reason}`);
    return r.state;
  }, state);
}

/** Every sample, plus the other visibilities a ballot can have (design §11.2). */
const samples: GameEvent[] = [
  ...(Object.values(sampleEvents) as GameEvent[]),
  { ...sampleEvents.voteCast, visibility: PUBLIC },
  { ...sampleEvents.voteCast, visibility: secretTo("ben") },
  { ...sampleEvents.voteSealed, visibility: secretTo("ben") },
];

describe("viewFor over every event type — design §17.2, §13", () => {
  const base = createGame(config());

  it.each(samples.map((e) => [`${e.type} (${e.visibility.kind})`, e] as const))("%s", (_label, event) => {
    const v = event.visibility;
    for (const viewer of VIEWERS) {
      const owns = (v.kind === "private" || v.kind === "secret") && v.player === viewer;

      // During the game: public → ledger; own private/secret → case file; anything else nowhere.
      const during = viewFor(withEvent(base, event), viewer);
      expect(has(during.ledger, event), `${viewer} ledger`).toBe(v.kind === "public");
      expect(has(during.caseFile, event), `${viewer} case file`).toBe(owns);
      expect(during.reveal).toBeNull();

      // After: ledger and case file unchanged; the reveal opens all but others' secrets (§11.2).
      const after = viewFor(ended(withEvent(base, event)), viewer);
      expect(has(after.ledger, event)).toBe(v.kind === "public");
      expect(has(after.caseFile, event)).toBe(owns);
      expect(has(after.reveal?.log ?? [], event), `${viewer} reveal`).toBe(v.kind !== "secret" || owns);
    }
  });

  it("covers every event type", () => {
    expect(new Set(samples.map((e) => e.type))).toEqual(new Set(Object.keys(sampleEvents)));
  });
});

describe("ledger and case file are narrowed by type — design §13", () => {
  it("ledger events are public, case-file events private or secret", () => {
    expectTypeOf<PlayerView["ledger"][number]["event"]["visibility"]>().toEqualTypeOf<PublicVisibility>();
    expectTypeOf<PlayerView["caseFile"][number]["event"]["visibility"]>().toEqualTypeOf<PrivateVisibility | SecretVisibility>();
    // A ballot can be on either; a dealt role only in the case file.
    expectTypeOf<"voteCast">().toMatchTypeOf<PlayerView["ledger"][number]["event"]["type"]>();
    expectTypeOf<Extract<PlayerView["ledger"][number]["event"]["type"], "roleDealt" | "rngSeeded">>().toBeNever();
    expectTypeOf<Extract<PlayerView["caseFile"][number]["event"]["type"], "gameCreated" | "rngSeeded">>().toBeNever();
  });
});

describe("viewFor — the viewer's own data and public state — design §13", () => {
  it("me: own role, stash, safe, move and ballots; others: seat info only", () => {
    let s = createGame(config());
    s = run(s, { type: "submitMove", player: "ana", move: { room: "office", pocket: 1 } }, { type: "sealVote", player: "ben", vote: { kind: "skip" } });
    const ana = viewFor(s, "ana");
    expect(ana.me).toEqual({
      id: "ana",
      role: s.players.ana?.role,
      stash: 0,
      safe: 0,
      roleState: { usedThisAct: 0, usedThisGame: 0, target: null, perks: [], tail: null, tokens: 0 },
      emergencyMeetingUsed: false,
      tipOffs: 0,
      move: { room: "office", pocket: 1 },
      sealedVote: null,
      vote: null,
      seenBallots: {},
    });
    expect(ana.players).toEqual([
      { id: "ben", name: "Ben", isBot: true, emergencyMeetingUsed: false },
      { id: "carl", name: "Carl", isBot: false, emergencyMeetingUsed: false },
    ]);
    expect(viewFor(s, "ben").me.sealedVote).toEqual({ kind: "skip" });
    expect(viewFor(s, "ben").me.move).toBeNull();
  });

  it("public state: phase, round, act, rooms, Haul, Heat, meetings — design §13, §11.1", () => {
    let s = createGame(config());
    s = run(s, { type: "proposeMeeting", player: "ana", slot: "fri" }, { type: "callEmergency", player: "carl" });
    const v = viewFor(s, "ben");
    expect([v.phase, v.round, v.act, v.haul, v.heat, v.voteVisibility]).toEqual([{ kind: "planning", round: 1 }, 1, 1, 0, 0, "hiddenThenRevealed"]);
    expect(v.rooms).toEqual(s.rooms);
    expect(v.proposals).toEqual([{ id: "proposal-1", by: "ana", act: 1, slot: "fri", acceptedBy: ["ana"] }]);
    expect(v.pendingEmergency).toEqual({ meetingId: "emergency-carl", by: "carl" });
    expect(v.players.find((p) => p.id === "carl")?.emergencyMeetingUsed).toBe(true);
  });

  // STATUS note for task 8: meeting.votes holds every ballot; only your own reaches your view.
  it("me.vote is your own ballot; hidden ballots of others stay out — design §11.2", () => {
    let s = createGame(config());
    s = run(s, { type: "callEmergency", player: "ana" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-ana" } });
    s = run(s, { type: "castVote", player: "ben", vote: { kind: "shakedown", target: "ana" } }, { type: "castVote", player: "ana", vote: { kind: "skip" } });
    expect(viewFor(s, "ana").me.vote).toEqual({ kind: "skip" });
    expect(viewFor(s, "ben").me.vote).toEqual({ kind: "shakedown", target: "ana" });
    expect(viewFor(s, "carl").me.vote).toBeNull();
    expect(JSON.stringify(viewFor(s, "carl"))).not.toContain("shakedown");
  });

  it("refuses a player who isn't seated", () => {
    expect(() => viewFor(createGame(config()), "dora")).toThrow(/unknown player/);
    expect(() => viewFor(createGame(config()), "__proto__")).toThrow(/unknown player/);
  });
});

describe("seq numbers count only what you can see — design §13, docs/decisions.md", () => {
  const merged = (v: PlayerView) => [...v.ledger, ...v.caseFile].map((e) => e.seq).sort((a, b) => a - b);

  it("ledger and case file share one gap-free numbering", () => {
    const s = createGame(config());
    for (const viewer of VIEWERS) {
      const seqs = merged(viewFor(s, viewer));
      expect(seqs).toEqual(seqs.map((_, i) => i));
    }
  });

  it("hidden events (e.g. a Fence using the safe) don't shift your numbers", () => {
    const s = createGame(config());
    const hidden: GameEvent[] = [
      { ...sampleEvents.abilityResolved, visibility: privateTo("ben"), player: "ben" },
      { type: "rngAdvanced", visibility: REVEAL, words: [1, 2, 3, 4] },
    ];
    const extra = { ...s, log: [...s.log.slice(0, 3), ...hidden, ...s.log.slice(3)] };
    expect(viewFor(extra, "ana").ledger).toEqual(viewFor(s, "ana").ledger);
    expect(viewFor(extra, "ana").caseFile).toEqual(viewFor(s, "ana").caseFile);
  });

  it("the reveal numbers its own stream, without gaps for others' secret ballots", () => {
    const s = ended(withEvent(withEvent(createGame(config()), { ...sampleEvents.voteSealed, visibility: secretTo("ben") }), sampleEvents.roundStarted));
    const log = viewFor(s, "ana").reveal?.log ?? [];
    expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i));
    expect(log.length).toBe(s.log.length - 1);
  });
});

describe("eventsSince — 'while you were away' input, design §13", () => {
  it("returns your visible events after a seq, oldest first", () => {
    let s = createGame(config());
    const last = Math.max(...[...viewFor(s, "ana").ledger, ...viewFor(s, "ana").caseFile].map((e) => e.seq));
    s = run(
      s,
      { type: "submitMove", player: "ana", move: { room: "office", pocket: 0 } },
      { type: "submitMove", player: "ben", move: { room: "vault", pocket: 0 } },
    );
    const since = eventsSince(viewFor(s, "ana"), last);
    // Ana's own lock-in, her move, then Ben's public lock-in (owner decision, 2 Nov; design §5.1).
    expect(since.map((e) => e.event.type)).toEqual(["moveLocked", "moveSubmitted", "moveLocked"]);
    expect(since[0]?.seq).toBe(last + 1);
    expect(eventsSince(viewFor(s, "ana"), -1).length).toBe(last + 4);
  });
});

describe("views are copies — design §17.3 (bots only get viewFor), task 8 review", () => {
  it("changing every part of a view changes neither the game nor later views", () => {
    // A game with a Security watch, a resolved round, an alibi, a proposal, a sealed vote and a pending move.
    let s = run(
      createGame(config()),
      { type: "submitMove", player: "ana", move: { room: "security", pocket: 0, watch: "vault" } },
      { type: "advance", deadline: { kind: "round", round: 1 } },
      { type: "postAlibi", player: "ana", room: "office" },
      { type: "advance", deadline: { kind: "alibis", round: 1 } },
      { type: "proposeMeeting", player: "ana", slot: "fri" },
      { type: "sealVote", player: "ana", vote: { kind: "shakedown", target: "ben" } },
      { type: "submitMove", player: "ana", move: { room: "office", pocket: 1 } },
    );
    const before = JSON.stringify(s);
    const view = viewFor(s, "ana");
    const fresh = JSON.stringify(view);

    // Write through everything the view holds, nested objects included (casts get past `readonly`).
    const scribble = (value: unknown): void => {
      if (typeof value !== "object" || value === null) return;
      if (Array.isArray(value)) {
        value.forEach(scribble);
        value.push("junk");
        return;
      }
      const obj = value as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        scribble(obj[key]);
        if (typeof obj[key] !== "object" || obj[key] === null) obj[key] = "junk";
      }
      obj.extra = "junk";
    };
    scribble(view);

    expect(JSON.stringify(s)).toBe(before);
    expect(JSON.stringify(viewFor(s, "ana"))).toBe(fresh);
    // And the game still plays the same afterwards.
    s = run(s, { type: "advance", deadline: { kind: "round", round: 2 } });
    expect(s.players.ana?.stash).toBe(1);
  });

  it("two views of the same state share nothing", () => {
    const s = createGame(config());
    const a = viewFor(s, "ana");
    const b = viewFor(s, "ana");
    expect(a).toEqual(b);
    expect(a.ledger[0]?.event).not.toBe(b.ledger[0]?.event);
    expect(a.rooms).not.toBe(s.rooms);
    expect(a.phase).not.toBe(s.phase);
    expect(a.ledger[0]?.event).not.toBe(s.log[0]);
  });
});

describe("view copies keep every key — PR #9 QA", () => {
  it("an entry keyed __proto__ survives the copy instead of becoming the prototype", () => {
    // Setup refuses such ids now; this guards the copy itself (QA's repro: a tally keyed by a __proto__ seat).
    const targets = JSON.parse('{"__proto__": 2, "ben": 1}') as Record<string, number>;
    const closed: GameEvent = { ...sampleEvents.meetingClosed, tally: { skip: 0, targets } };
    const copied = viewFor(withEvent(createGame(config()), closed), "ana").ledger.at(-1)?.event;
    expect(copied?.type === "meetingClosed" && Object.keys(copied.tally.targets)).toEqual(["__proto__", "ben"]);
    expect(copied && Object.getPrototypeOf(copied.type === "meetingClosed" ? copied.tally.targets : null)).toBe(Object.prototype);
  });

  it("validateConfig refuses unsafe player ids", () => {
    const players = ["__proto__", "constructor", "prototype"].map((id) => ({ id, name: id, isBot: false }));
    expect(validateConfig({ ...config(), players })).toEqual([expect.stringMatching(/player ids must match/)]);
    expect(validateConfig(config())).toEqual([]);
  });
});
